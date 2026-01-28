import type { Metadata } from "next";
import { Playfair_Display, Source_Sans_3, Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
});

const arabic = Noto_Naskh_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Presensi Kajian Ahad Pagi - Masjid Al Irsyad",
  description: "Presensi kajian Ahad pagi dengan master peserta dan leaderboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className={`${display.variable} ${sans.variable} ${arabic.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
