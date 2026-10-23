/**
 * Shared community copy — used by /register, /welcome and the in-app /guide so
 * the orientation, guidelines and setup steps never drift between them.
 */

/** How the service works, in four beats (orientation). */
export const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "Get Moonfin",
    body: "Install the free Moonfin app on your phone, TV or computer and sign in with your Cinevault username & password. It's where you watch — and where you ask for new things.",
  },
  {
    title: "Find anything",
    body: "Search in Moonfin for any movie or show. If it's not here yet, tap Request. (You can also use Search or Discover in the Cinevault app.)",
  },
  {
    title: "We fetch it",
    body: "If it's already in the shared library it's there instantly; otherwise it's downloaded into your library — usually within minutes — and you get a notification when it's ready.",
  },
  {
    title: "Your own space",
    body: "Everyone has their own library, follows and notifications — and you can stream everything other members have added too. Connect Telegram or turn on push to get pinged the moment a title is ready.",
  },
];

/** The strict, non-negotiable community rules. */
export const GUIDELINES: { t: string; d: string }[] = [
  {
    t: "Don't share your account — 1 screen at a time.",
    d: "Your login is yours alone. Only one stream can play at a time; sharing your account or streaming on multiple screens will flag it and may get you removed.",
  },
  {
    t: "For shows, add one season — the rest follow as you watch.",
    d: "Add a single season to start: from the beginning or jump in at any season. As you near the end of it, the next season is added for you automatically — so there's no need to grab a whole series at once. Storage is shared.",
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

/** Official Jellyfin clients — the fallback app (it plays the library but can't
 *  request). Mainly for Samsung/LG TVs, where Moonfin isn't in the store. The
 *  catch-all goes to the canonical downloads page (always correct for LG/Samsung). */
export const JELLYFIN_APPS: { label: string; href: string; kind: "mobile" | "tv" }[] = [
  { label: "iPhone / iPad", href: "https://apps.apple.com/app/jellyfin-mobile/id1480192618", kind: "mobile" },
  { label: "Android", href: "https://play.google.com/store/apps/details?id=org.jellyfin.mobile", kind: "mobile" },
  { label: "Android TV / Fire TV", href: "https://play.google.com/store/apps/details?id=org.jellyfin.androidtv", kind: "tv" },
  { label: "Roku, LG, Samsung & more", href: "https://jellyfin.org/downloads/clients/", kind: "tv" },
];

/**
 * Moonfin is the app members use: it plays the shared Jellyfin library AND can
 * request (through the server's Seerr). The official Jellyfin app is the
 * fallback — mainly for Samsung/LG TVs, where Moonfin isn't in the store.
 */
export const MOONFIN_WHY: string[] = [
  "Watch everything in the shared library, on your phone, TV or computer.",
  "Request anything: its search finds every movie and show — not just what's already here. Tap Request and it's downloaded into your library.",
];

/** Moonfin store listings. Samsung & LG TVs have none (sideload only), so they're left out on purpose. */
export const MOONFIN_APPS: { label: string; href: string; kind: "mobile" | "tv" }[] = [
  { label: "Android phone & Android / Google TV", href: "https://play.google.com/store/apps/details?id=org.moonfin.androidtv", kind: "mobile" },
  { label: "iPhone, iPad & Apple TV", href: "https://apps.apple.com/app/moonfin/id6761283970", kind: "mobile" },
  { label: "Fire TV", href: "https://www.amazon.com/Moonfin/dp/B0H76BG3DW", kind: "tv" },
  { label: "Roku", href: "https://channelstore.roku.com/details/92a83c9f4112b76a7bcee3dc076254ca:3251a91bf7af7339652d5409ccfdcb39/moonfin", kind: "tv" },
];
