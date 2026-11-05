import type { Metadata } from "next";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireRole } from "@/lib/account/server";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";

export const metadata: Metadata = { title: "Home" };

/** Student home. Empty for now: practice, plan and grades arrive in Phase 3 (docs/PLAN.md). */
export default async function StudentHome() {
  const s = await requireRole("student");
  const brand = await currentBrand();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={brand.defaultTheme} nav={[{ href: "/student", label: "Home", icon: "home" }]} current="/student" actions={<SignOut />}>
      <h1 className="s-h1">Hi, {s.firstName}</h1>
      <section className="s-card">
        <h2 className="s-h2">Your plan shows here</h2>
        <p className="s-muted">Practice questions, your predicted grades and a daily plan are on the way. We will email you when they open.</p>
      </section>
    </StudentFrame>
  );
}
