import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { appName } from "@/lib/env";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const name = await appName();
  return {
    title: { default: name, template: `%s | ${name}` },
    description: "Practice, marking and progress for Cambridge exam students.",
    // Nothing is public yet. Lift this when the landing page is ready.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers keeps every page dynamic, which the CSP nonce needs.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
