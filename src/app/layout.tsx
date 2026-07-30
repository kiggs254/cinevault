import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/pwa-register";

const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas" });
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cinevault — AI film & TV vault",
  description: "A self-hosted, AI-curated film & TV vault with S3 archiving.",
  applicationName: "Cinevault",
  appleWebApp: { capable: true, title: "Cinevault", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // extend under the notch/home-indicator for safe-area insets
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

// Runs before paint: applies the saved (or system) theme so there's no flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${bebas.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <PwaRegister />
        <div className="glow" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <div className="relative z-[2]">{children}</div>
      </body>
    </html>
  );
}
