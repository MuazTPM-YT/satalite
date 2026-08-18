import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SatAlite",
  description: "Concrete curing prediction from hyperlocal air temperature",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-black/10 dark:border-white/15 px-6 py-4">
          <span className="font-semibold tracking-tight">SatAlite</span>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
