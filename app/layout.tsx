import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGate } from "@/components/memory/auth-gate";

export const metadata: Metadata = {
  title: "FRIDAY | Cognitive Memory Router",
  description:
    "Transform unstructured thoughts into structured temporal memories and entity records. Layer 1 Ingestion Protocol powered by Groq AI.",
  keywords: ["AI", "memory", "cognitive", "temporal", "entity", "Groq", "transcription"],
};

export const viewport: Viewport = {
  themeColor: "#0A0F1C",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-background" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
