import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFrame } from "@/components/SiteFrame";

/*
 * Anteprima dei link condivisi (WhatsApp, Telegram, social): titolo, descrizione e
 * immagine Open Graph. L'immagine è generata da `app/opengraph-image.tsx` (stessa
 * origine, nessun asset esterno). `metadataBase` serve a rendere ASSOLUTO l'URL
 * dell'immagine: se NEXT_PUBLIC_SITE_URL manca, Next ripiega sull'URL di Vercel.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const TITLE = "Burraco — Circolo Nettuno";
const DESCRIPTION = "Burraco online gratuito e senza pubblicità. Siediti al tavolo e invita un amico.";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "it_IT",
    siteName: "Circolo Nettuno",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0e2a22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        {children}
        <SiteFrame />
      </body>
    </html>
  );
}
