import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://cmo.xyz"),
  title: "CMO.XYZ | AI CMO & Autonomous Marketing Agent",
  description: "Meet Cuso, your AI CMO. He learns your brand, runs your social, ads, SEO and newsletter, and tells you what he learned. Join the waitlist.",
  openGraph: { images: "/og-image.png" },
};

export const viewport: Viewport = { themeColor: "#f7f6f2" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
