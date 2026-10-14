import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://cmo.xyz"),
  title: "CMO.XYZ | AI CMO & Autonomous Marketing Agent",
  description: "Meet Cuso, your AI CMO. He learns your brand, runs your social, ads, SEO and newsletter, and tells you what he learned. Join the waitlist.",
  openGraph: { images: "/og-image.png" },
};

// cover: the city runs under the notch; --edge-* in globals.css keeps the UI clear of it.
// resizes-visual: the on-screen keyboard never resizes the page, so the story does not jump.
export const viewport: Viewport = { themeColor: "#f7f6f2", viewportFit: "cover", interactiveWidget: "resizes-visual" };

// Google Analytics, only when NEXT_PUBLIC_GA_ID is set (G-82QM6MPVWK in production),
// so dev and tests send nothing. Same tag as the live site; the form fires sign_up.
const gaId = process.env.NEXT_PUBLIC_GA_ID;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
      {gaId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
          <Script id="ga">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(gaId)});`}
          </Script>
        </>
      )}
    </html>
  );
}
