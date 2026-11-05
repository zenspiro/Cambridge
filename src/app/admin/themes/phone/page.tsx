import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { ThemeGallery } from "@/components/student/ThemeGallery";
import { THEMES, type ThemeId } from "@/lib/config";

export const metadata: Metadata = { title: "Theme preview" };

/** The theme gallery as a whole page, without the admin frame: exactly what a student would see. */
export default async function ThemePhonePage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  await requireAdmin();
  const brand = await currentBrand();
  const asked = (await searchParams).theme;
  const theme: ThemeId = THEMES.find((t) => t.id === asked)?.id ?? brand.defaultTheme;
  return <ThemeGallery brand={frameBrand(brand)} initial={theme} boxed={false} />;
}
