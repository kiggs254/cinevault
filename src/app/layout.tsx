import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
  title: "MOVIE HUB — AI Media Deck",
  description: "A self-hosted, AI-driven media downloader with S3 archiving.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // extend under the notch/home-indicator for safe-area insets
  themeColor: "#0b0b0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bebas.variable} ${hanken.variable} ${jetbrains.variable}`}>
      <body>
        <div className="glow" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <div className="relative z-[2]">{children}</div>
      </body>
    </html>
  );
}
