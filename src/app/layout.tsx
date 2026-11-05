import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { currentBrand } from "@/lib/env";
import { brandUrl } from "@/lib/brand";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  // Name, description and icons come from the Brand page (/admin/brand), never from code.
  const brand = await currentBrand();
  const { favicon, square } = brand.images;
  return {
    title: { default: brand.name, template: `%s | ${brand.name}` },
    description: brand.description,
    applicationName: brand.shortName,
    icons: {
      icon: favicon ? [{ url: brandUrl(favicon), type: favicon.type }] : square ? [{ url: brandUrl(square), type: square.type }] : undefined,
      apple: square ? [{ url: brandUrl(square) }] : undefined,
    },
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
