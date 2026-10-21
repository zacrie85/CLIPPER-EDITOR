import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "CLIPPER EDITOR — AI Clip Studio 100% Offline",
  description:
    "Editor video clipper: split otomatis per adegan, subtitle AI lokal (Whisper), zoom pembicara otomatis (YOLOS-tiny), musik AI prosedural, tipografi sinematik, pelacak objek NCC, ekspor MP4 H.264 hingga 4K — semua di browser, tanpa unggah.",
  keywords: [
    "clipper", "video editor", "AI clipping", "whisper", "YOLOS", "WebCodecs",
    "TikTok", "Shorts", "Reels", "split otomatis", "zoom pembicara",
  ],
  icons: {
    icon:
      "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='#e21d1d'/><path d='M18 18h28v10H32l14 18H18V36h14L18 18z' fill='#fff'/></svg>`
      ),
  },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        {/* Font sinematik: dimuat runtime — sekali saja, lalu cache browser */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Cinzel:wght@700;900&family=Anton&family=Bebas+Neue&family=Oswald:wght@500;600;700&family=Playfair+Display:wght@700;900&family=Archivo+Black&family=Montserrat:wght@500;600;700;800&family=Orbitron:wght@600;700;900&family=Permanent+Marker&family=Caveat:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
