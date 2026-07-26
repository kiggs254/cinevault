import { prisma } from "../db";
import { getConfig, saveConfig } from "../config";
import { getPlayedTitles, jellyfinReady } from "../jellyfin/client";
import { buildTasteProfile, type TasteSignals } from "../llm/taste";
import { rankRecommendations } from "../llm/recommend";
import {
  getRecommendations,
  getSimilar,
  getTrending,
  discoverByGenres,
  getGenres,
  searchTitle,
  type TmdbTitle,
  type TmdbMediaType,
} from "../metadata/tmdb";

const SEED_LIMIT = 10;

/** Recompute the taste profile from watch + download history and persist it. */
export async function refreshTasteProfile(): Promise<void> {
  const cfg = await getConfig();
  const watched = jellyfinReady(cfg.jellyfin) ? await getPlayedTitles(cfg.jellyfin, 100) : [];
  const downloads = await prisma.download.findMany({
    where: { status: "COMPLETED" },
    select: { title: true, kind: true, year: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const signals: TasteSignals = {
    watched: watched.map((w) => ({
      name: w.name,
      type: w.type,
      genres: w.genres,
      people: w.people,
      year: w.year,
      playCount: w.playCount,
    })),
    downloaded: downloads.map((d) => ({ title: d.title, kind: d.kind, year: d.year })),
    interests: cfg.profile.interests,
  };
  if (!signals.watched.length && !signals.downloaded.length && !signals.interests.length) return;
  try {
    const profile = await buildTasteProfile(signals);
    await saveConfig({ tasteProfile: profile });
  } catch (e) {
    console.error("[reco] taste build failed:", (e as Error).message);
  }
}

/** Rebuild the recommendation feed. Returns how many suggestions were stored. */
export async function refreshRecommendations(): Promise<{ count: number; reason?: string }> {
  const cfg = await getConfig();
  const apiKey = cfg.tmdb.apiKey;
  if (!apiKey) return { count: 0, reason: "TMDB API key not configured" };

  await refreshTasteProfile();
  const profile = (await getConfig()).tasteProfile;

  const [downloads, follows, dismissed, watched] = await Promise.all([
    prisma.download.findMany({ select: { tmdbId: true } }),
    prisma.followedShow.findMany({ select: { tmdbId: true } }),
    prisma.recommendation.findMany({ where: { status: "dismissed" }, select: { tmdbId: true } }),
    jellyfinReady(cfg.jellyfin) ? getPlayedTitles(cfg.jellyfin, 100) : Promise.resolve([]),
  ]);
  const exclude = new Set<number>();
  for (const d of downloads) if (d.tmdbId) exclude.add(d.tmdbId);
  for (const f of follows) exclude.add(f.tmdbId);
  for (const r of dismissed) exclude.add(r.tmdbId);
  for (const w of watched) if (w.tmdbId) exclude.add(w.tmdbId);

  // Seeds: watched titles with a TMDB id, topped up from recent downloads.
  const seeds: { id: number; type: TmdbMediaType }[] = [];
  for (const w of watched.slice(0, SEED_LIMIT)) {
    if (w.tmdbId) seeds.push({ id: w.tmdbId, type: w.type === "Series" ? "tv" : "movie" });
  }
  if (seeds.length < 4) {
    const recent = await prisma.download.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { title: true, kind: true, year: true, tmdbId: true },
    });
    for (const d of recent) {
      const type: TmdbMediaType = d.kind === "TV" ? "tv" : "movie";
      let id = d.tmdbId ?? undefined;
      if (!id) id = (await searchTitle(apiKey, type, d.title, d.year ?? undefined))?.tmdbId;
      if (id) seeds.push({ id, type });
    }
  }

  // Build the candidate pool from TMDB (real, current titles).
  const pool = new Map<string, TmdbTitle>();
  const addAll = (arr: TmdbTitle[]) => {
    for (const t of arr) if (!exclude.has(t.tmdbId)) pool.set(`${t.mediaType}:${t.tmdbId}`, t);
  };
  for (const s of seeds.slice(0, SEED_LIMIT)) {
    addAll(await getRecommendations(apiKey, s.type, s.id));
    addAll(await getSimilar(apiKey, s.type, s.id));
  }
  addAll(await getTrending(apiKey, "all"));
  if (profile?.favoriteGenres?.length) {
    for (const type of ["tv", "movie"] as TmdbMediaType[]) {
      const genres = await getGenres(apiKey, type);
      const ids = profile.favoriteGenres
        .map((g) => genres.find((x) => x.name.toLowerCase() === g.toLowerCase())?.id)
        .filter((n): n is number => !!n)
        .slice(0, 3);
      if (ids.length) addAll(await discoverByGenres(apiKey, type, ids));
    }
  }

  const candidates = [...pool.values()];
  if (candidates.length === 0) return { count: 0, reason: "No candidates — watch or download something first" };

  const ranked = await rankRecommendations(profile, candidates, 30);

  // Replace the previous "new" feed; keep dismissed/added history.
  await prisma.recommendation.deleteMany({ where: { status: "new" } });
  let count = 0;
  for (const pick of ranked.picks) {
    const c = candidates[pick.index];
    if (!c) continue;
    try {
      await prisma.recommendation.upsert({
        where: { tmdbId_mediaType: { tmdbId: c.tmdbId, mediaType: c.mediaType } },
        update: {
          title: c.title,
          year: c.year ?? null,
          posterUrl: c.posterUrl ?? null,
          overview: c.overview ?? null,
          reason: pick.reason || null,
          score: pick.score,
          status: "new",
        },
        create: {
          tmdbId: c.tmdbId,
          mediaType: c.mediaType,
          title: c.title,
          year: c.year ?? null,
          posterUrl: c.posterUrl ?? null,
          overview: c.overview ?? null,
          reason: pick.reason || null,
          score: pick.score,
          source: "ai",
          status: "new",
        },
      });
      count++;
    } catch {
      /* skip conflicting row */
    }
  }
  return { count };
}
