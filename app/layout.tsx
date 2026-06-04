import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LXV | Cognitive Router",
  description:
    "Layer 1 Ingestion Protocol — Temporal memory routing engine powered by Groq.",
};

export const viewport: Viewport = {
  themeColor: "#0A0F1C",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
