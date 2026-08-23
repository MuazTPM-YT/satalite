import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// self-hosted Inter via next/font
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SatAlite Studio",
  description: "Concrete curing prediction from hyperlocal air temperature",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} dark`}>
      <body>{children}</body>
    </html>
  );
}
