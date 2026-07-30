"use client";

import { useEffect, useState } from "react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";
import { HeroSlider, type HeroItem } from "@/components/hero-slider";
import { BrowseRows, type TmdbItem } from "@/components/browse-rows";

export default function HomePage() {
  const [heroItems, setHeroItems] = useState<HeroItem[]>([]);
  const [seed, setSeed] = useState<TitleSeed | null>(null);

  useEffect(() => {
    jsonFetch<{ items: HeroItem[] }>("/api/hero")
      .then((d) => setHeroItems(d.items ?? []))
      .catch(() => {});
  }, []);

  const open = (i: TmdbItem) =>
    setSeed({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType === "movie" ? "movie" : "tv",
      title: i.title,
      year: i.year ?? null,
      posterUrl: i.posterUrl ?? null,
    });

  const hasHero = heroItems.length > 0;

  return (
    <div className="min-h-full">
      {hasHero && <HeroSlider items={heroItems} onOpen={open} />}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        <BrowseRows onOpen={open} />
      </div>

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
