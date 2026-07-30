import type { MetadataRoute } from "next";

/** PWA manifest — served at /manifest.webmanifest. Enables install + web push. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cinevault",
    short_name: "Cinevault",
    description: "Your private AI film & TV vault — browse, add to your library, and watch on Jellyfin.",
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    categories: ["entertainment", "video"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
