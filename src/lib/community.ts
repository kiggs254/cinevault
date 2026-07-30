/**
 * Shared community copy — used by /register, /welcome and the in-app /guide so
 * the orientation, guidelines and setup steps never drift between them.
 */

/** How the service works, in four beats (orientation). */
export const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "Find it",
    body: "Use Search or Discover to find any movie or show, open it, and tap Add to Library.",
  },
  {
    title: "We fetch it",
    body: "If it's already in the shared library it's added instantly; otherwise it's downloaded and shows up in your library — usually within minutes.",
  },
  {
    title: "Watch on Jellyfin",
    body: "Install the free Jellyfin app on any device and sign in with the same username & password to stream anything in your library.",
  },
  {
    title: "Your own space",
    body: "Everyone has their own library, follows and notifications. Connect Telegram or turn on push to get pinged the moment a title is ready.",
  },
];

/** The strict, non-negotiable community rules. */
export const GUIDELINES: { t: string; d: string }[] = [
  {
    t: "Don't share your account — 1 screen at a time.",
    d: "Your login is yours alone. Only one stream can play at a time; sharing your account or streaming on multiple screens will flag it and may get you removed.",
  },
  {
    t: "For shows, add only the season(s) you'll actually watch.",
    d: "Storage is shared. Don't bulk-add a whole series “just in case” — pick the season you're watching now; add the next one when you get there.",
  },
  {
    t: "Finished watching? Delete it from your library.",
    d: "Clear things out once you're done to free up space. You can always request the exact same title again later — nothing is lost.",
  },
  {
    t: "Keep it private — check with the admin first.",
    d: "Never tell anyone about Cinevault or hand out an invite without clearing it with the admin. This stays small and trusted on purpose.",
  },
];

/** Official Jellyfin clients. Store links are stable; the catch-all goes to the
 *  canonical downloads page (always correct for Fire TV / Roku / LG / Samsung). */
export const JELLYFIN_APPS: { label: string; href: string; kind: "mobile" | "tv" }[] = [
  { label: "iPhone / iPad", href: "https://apps.apple.com/app/jellyfin-mobile/id1480192618", kind: "mobile" },
  { label: "Android", href: "https://play.google.com/store/apps/details?id=org.jellyfin.mobile", kind: "mobile" },
  { label: "Android TV / Fire TV", href: "https://play.google.com/store/apps/details?id=org.jellyfin.androidtv", kind: "tv" },
  { label: "Roku, LG, Samsung & more", href: "https://jellyfin.org/downloads/clients/", kind: "tv" },
];
