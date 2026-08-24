import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist for the interface, Geist Mono for every measured quantity. Engineering
// readouts are compared column-to-column, so digits must not change width.
const geistSans = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

// Where this deployment is served from. Absolute URLs are what a crawler and a link
// unfurler both need; a relative one would be a build error under metadataBase.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const DESCRIPTION =
  "Predict concrete curing from hyperlocal air temperature: solved cross-section " +
  "temperature fields, DEF and cracking thresholds, evaporation risk and strip time.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The page sets its own name; anything nested says "… — SatAlite Studio".
  title: {
    default: "SatAlite Studio — concrete curing prediction",
    template: "%s — SatAlite Studio",
  },
  description: DESCRIPTION,
  applicationName: "SatAlite Studio",
  keywords: [
    "concrete curing",
    "heat of hydration",
    "maturity method",
    "delayed ettringite formation",
    "thermal cracking",
    "strip time",
    "ACI 305",
    "USBR DSO-12-02",
    "finite volume solver",
  ],
  category: "engineering",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "SatAlite Studio",
    title: "SatAlite Studio — concrete curing prediction",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "SatAlite Studio — concrete curing prediction",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: false, address: false, email: false },
};

// themeColor is the app ground, so the browser chrome around the viewer matches it
// rather than flashing white before the first paint.
export const viewport: Viewport = {
  themeColor: "#0a0b0c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

// What this is, in the vocabulary a search engine indexes rather than the one a
// reader sees. Emitted once, in the document head, from the same constants the
// metadata above uses - so the two cannot describe two different products.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SatAlite Studio",
  applicationCategory: "EngineeringApplication",
  operatingSystem: "Any modern browser",
  url: SITE_URL,
  description: DESCRIPTION,
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  featureList: [
    "2D finite-volume thermal solve of a concrete cross-section",
    "Schindler–Folliard cement hydration",
    "ASTM C1074 maturity and strength gain",
    "DEF, thermal cracking, evaporation and placement threshold checks",
    "Monte Carlo p05/p95 bands",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <head>
        {/* No font preconnect: next/font/google downloads Geist at BUILD time and
            serves it from this origin, so the page makes no cross-origin request and a
            preconnect to Google would open a connection nothing ever uses. */}
        <script
          type="application/ld+json"
          // The object is a constant in this file. Nothing user-supplied reaches it,
          // so there is no injection surface to escape.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
