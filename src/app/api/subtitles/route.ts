import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser, isAdmin } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { requestSubtitles, subtitleSettings } from "@/lib/subtitles/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const Body = z
  .object({
    downloadId: z.string().min(1).max(64).optional(),
    tmdbId: z.number().int().positive().optional(),
    season: z.number().int().min(0).max(200).optional(),
  })
  .refine((b) => !!b.downloadId || b.tmdbId != null, {
    message: "downloadId or tmdbId is required",
  });

/** Whether subtitles are available to ask for, and in which languages. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  return NextResponse.json(await subtitleSettings(), { headers: NO_STORE });
}

/**
 * Ask for subtitles for one item, a whole season, or a whole title. Members can
 * only request against their own library; admins can request for anything.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  // Each request can fan out to a season's worth of provider lookups, and those
  // have small daily quotas — so cap how fast one member can spend them.
  if (!(await rateLimit(`subs:${user.id}`, 20, 600))) {
    return NextResponse.json(
      { ok: false, message: "Too many subtitle requests just now — try again in a few minutes." },
      { status: 429, headers: NO_STORE },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await requestSubtitles(parsed.data, {
    userId: user.id,
    isAdmin: isAdmin(user),
  });
  return NextResponse.json(result, { headers: NO_STORE });
}
