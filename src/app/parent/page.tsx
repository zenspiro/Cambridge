import type { Metadata } from "next";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireRole } from "@/lib/account/server";
import { PARENT_THEME } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";

export const metadata: Metadata = { title: "Family" };

/** Parent home, always in the calm look. Empty for now: families arrive in step 4 (docs/PLAN.md). */
export default async function ParentHome() {
  const s = await requireRole("parent");
  const brand = await currentBrand();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={PARENT_THEME} nav={[{ href: "/parent", label: "Family", icon: "home" }]} current="/parent" actions={<SignOut />}>
      <h1 className="s-h1">Hi, {s.firstName}</h1>
      <section className="s-card">
        <h2 className="s-h2">Your family shows here</h2>
        <p className="s-muted">Soon you can add your children and follow their progress, weak topics and mock results.</p>
      </section>
    </StudentFrame>
  );
}
