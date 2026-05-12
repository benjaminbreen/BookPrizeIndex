import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, IM_Fell_English, IM_Fell_English_SC, Newsreader, Public_Sans } from "next/font/google";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";

const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  adjustFontFallback: false,
});

const serif = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-serif",
  adjustFontFallback: false,
});

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  adjustFontFallback: false,
});

const number = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-number",
  adjustFontFallback: false,
});

const fell = IM_Fell_English({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-fell",
  adjustFontFallback: false,
});

const fellSc = IM_Fell_English_SC({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-fell-sc",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "The Book Prize Index",
  description: "A sourced index of nonfiction book awards, publishers, imprints, subjects, and prize records.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable} ${number.variable} ${fell.variable} ${fellSc.variable}`}>
      <body className="font-[var(--font-sans)]">
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
