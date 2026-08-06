import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burraco — Circolo Notturno",
  description: "Burraco 1v1 real-time — il tavolo del circolo, uno contro uno.",
};

export const viewport: Viewport = {
  themeColor: "#0e2a22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
