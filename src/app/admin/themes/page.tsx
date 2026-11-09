import { ADMIN_EDIT, ADMIN_VIEW, allowed, requireStaff } from "@/lib/auth/staff";
import type { Metadata } from "next";
import Link from "next/link";
import { currentBrand, getEnv } from "@/lib/env";
import { readIcons } from "@/lib/icons";
import { frameBrand } from "@/lib/brand";
import { AdminShell } from "@/components/AdminShell";
import { ThemeGallery } from "@/components/student/ThemeGallery";
import { PARENT_THEME, THEMES } from "@/lib/config";

export const metadata: Metadata = { title: "Themes" };

export default async function ThemesPage() {
  const staff = await requireStaff(ADMIN_VIEW);
  const brand = await currentBrand();
  const parent = THEMES.find((t) => t.id === PARENT_THEME)?.label;
  return (
    <AdminShell
      readOnly={!allowed(staff, ADMIN_EDIT)}
      current="/admin/themes"
      title="Themes"
      actions={<Link className="btn" href="/admin/themes/phone">Open as a full page</Link>}
    >
      <div className="gallery-row">
        <ThemeGallery brand={frameBrand(brand)} initial={brand.defaultTheme} boxed icons={await readIcons((await getEnv()).DB)} />
        <div className="gallery-side">
          <p className="muted">
            Every building block of the student pages, with sample words, in a phone-sized box. Switch the theme at the top of
            the phone: only the look changes, the words stay the same. Pick an answer to see the feedback.
          </p>
          <p className="muted">
            New students start in the theme set on the <Link className="link" href="/admin/brand">Brand page</Link>. Parent pages
            always use the calm {parent} look.
          </p>
          <p>
            <Link className="link" href="/admin/themes/phone">Open as a full page</Link> (what a student sees on their phone or laptop).
          </p>
        </div>
      </div>
    </AdminShell>
  );
}
