import { ADMIN_VIEW, requireStaff } from "@/lib/auth/staff";
import type { Metadata } from "next";
import { currentBrand, getEnv } from "@/lib/env";
import { readIcons } from "@/lib/icons";
import { frameBrand } from "@/lib/brand";
import { ThemeGallery } from "@/components/student/ThemeGallery";
import { THEMES, type ThemeId } from "@/lib/config";

export const metadata: Metadata = { title: "Theme preview" };

/** The theme gallery as a whole page, without the admin frame: exactly what a student would see. */
export default async function ThemePhonePage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const staff = await requireStaff(ADMIN_VIEW);
  const brand = await currentBrand();
  const asked = (await searchParams).theme;
  const theme: ThemeId = THEMES.find((t) => t.id === asked)?.id ?? brand.defaultTheme;
  return <ThemeGallery brand={frameBrand(brand)} initial={theme} boxed={false} icons={await readIcons((await getEnv()).DB)} />;
}
