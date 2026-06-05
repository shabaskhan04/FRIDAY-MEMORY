import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthGate } from "@/components/memory/auth-gate";
import { PwaLifecycle } from "@/components/pwa/pwa-lifecycle";
import { ActionApprovalModal } from "@/components/memory/action-approval-modal"; // ✅ add this

export const metadata: Metadata = {
  metadataBase: new URL("https://friday-memory.local"),
  title: {
    default: "FRIDAY | Cognitive Memory Router",
    template: "%s | FRIDAY",
  },
  applicationName: "FRIDAY Memory",
  description:
    "Transform unstructured thoughts into structured temporal memories and entity records. Layer 1 Ingestion Protocol powered by Groq AI.",
  keywords: ["AI", "memory", "cognitive", "temporal", "entity", "Groq", "transcription"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FRIDAY",
  },
  formatDetection: {
    telephone: false,
  },
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
        <PwaLifecycle />
        <ActionApprovalModal /> {/* ✅ modal will render when needed */}
      </body>
    </html>
  );
}