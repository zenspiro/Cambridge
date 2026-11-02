import { adminPost } from "@/lib/adminPost";
import { audit } from "@/lib/auth/session";
import { checkVariants } from "@/lib/settings";

// Essential variants for one syllabus code (all its versions).
export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/library", async ({ db, form, actorId }) => {
    const code = String(form.get("code") ?? "");
    if (!/^\d{4}$/.test(code)) return "unknown";
    const value = checkVariants(Object.fromEntries((["m", "s", "w"] as const).map((s) => [s, form.getAll(`ev_${s}`).map(Number)])));
    if (!value || Object.values(value).some((v) => v.length === 0)) return `/admin/library/${code}?e=bad_variants`;
    const row = await db
      .prepare(`UPDATE syllabus SET essential_variants = ?2 WHERE code = ?1 RETURNING code`)
      .bind(code, JSON.stringify(value))
      .first();
    if (!row) return "unknown";
    await audit(db, { actorId, action: "syllabus.variants", entity: "syllabus", entityId: code });
    return `/admin/library/${code}?e=ok_variants`;
  });
}
