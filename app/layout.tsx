import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_Devanagari } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

// D23.1 typography: Plus Jakarta Sans is the Latin UI/brand face; Noto Sans
// Devanagari covers Nepali shop data and the rupee sign रू (U+0930 U+0942).
// The stacks live in globals.css @theme; each glyph falls through to the
// first font that has it.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
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
      className={`${plusJakartaSans.variable} ${notoDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
