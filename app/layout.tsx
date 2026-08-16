import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

// Latin brand face (Geist) + a Latin fallback with full currency coverage
// (the Nepali rupee रू, rendered in Devanagari) + a Devanagari face for the
// shop's Nepali names (D22.3). The stacks live in globals.css @theme; each
// glyph falls through to the first font that has it.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
});

export const metadata: Metadata = {
  title: "ERP Retail",
  description: "Shop management for a small retail business",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoSans.variable} ${notoDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
