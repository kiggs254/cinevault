"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
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
      {hasHero && (
        <div className="relative">
          <HeroSlider items={heroItems} onOpen={open} />
          {/* Search shortcut on the hero is mobile-only; desktop uses the sidebar's Search item. */}
          <div className="absolute right-4 top-4 z-20 flex justify-end md:hidden">
            <Link
              href="/search"
              aria-label="Search"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur-md transition hover:bg-black/50"
            >
              <SearchIcon size={19} />
            </Link>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        <BrowseRows onOpen={open} />
      </div>

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
