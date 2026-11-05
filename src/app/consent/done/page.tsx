import type { Metadata } from "next";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { PARENT_THEME } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";

export const metadata: Metadata = { title: "Parent approval", robots: { index: false } };

/** After the parent answered (public, fixed words by code). */
export default async function ConsentDone({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const r = (await searchParams).r;
  const brand = await currentBrand();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={PARENT_THEME} nav={[]} current="">
      <section className="s-card s-auth" aria-label="Parent approval">
        <h1 className="s-h1">{r === "approved" ? "Thank you" : r === "declined" ? "Done" : "Parent approval"}</h1>
        {r === "approved" ? (
          <>
            <p>Your child can now use {brand.name}.</p>
            <p>Want to follow their progress? <a className="s-link" href="/signin">Sign in as a parent</a> with this email.</p>
          </>
        ) : r === "declined" ? (
          <p>You declined. The account and everything in it has been deleted.</p>
        ) : r === "expired" ? (
          <p>This link has run out. Please ask your child to send a new one.</p>
        ) : r === "used" ? (
          <p>This request has already been answered. Thank you.</p>
        ) : (
          <p>This link does not work. Please ask your child to send a new one.</p>
        )}
      </section>
    </StudentFrame>
  );
}
