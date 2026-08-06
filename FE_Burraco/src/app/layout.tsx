import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burraco 2p",
  description: "Burraco 1v1 real-time — MVP (server autoritativo)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
