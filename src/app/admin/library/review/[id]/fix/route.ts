import { docSubject, staffPost } from "@/lib/auth/staff";
import { applyFix, PAPER_KINDS, paperDoc, type FixAction } from "@/lib/brain/paperRead";
import type { PaperKind } from "@/lib/brain/paper";

const ACTIONS: readonly FixAction[] = ["pdf", "edit", "fine", "looks_right", "box", "unfigure", "delfigure", "override", "unoverride", "review", "unreview", "undo"];
const field = (form: FormData, name: string, max: number) => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : undefined;
};

// One fix on the review screen: the PDF's version, your own wording, It's fine, Looks right, a figure's box drawn by
// hand, a figure taken off a part or deleted, ready anyway, or Undo.
// The flag, item and fix are named by key; what changes is read from our own stored reading, never the form.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = /^[A-Za-z0-9_-]{10,64}$/.test(id) ? `/admin/library/review/${id}` : "/admin/library";
  // The owner, or a team member with source review edit for this paper's subject (owner, 9 Nov 2026).
  return staffPost(request, back, { area: "sourceReview", level: "edit" }, async ({ db, env, form, actorId, check }) => {
    if (!check({ area: "sourceReview", level: "edit", code: await docSubject(db, id) })) return "no_access";
    const doc = await paperDoc(db, id);
    const action = ACTIONS.find((a) => a === form.get("action"));
    if (!doc || !PAPER_KINDS.includes(doc.docType as PaperKind) || !action) return "bad";
    return applyFix(db, env.FILES, doc, action, {
      key: field(form, "key", 80), item: field(form, "item", 24), text: field(form, "text", 8_000), marks: field(form, "marks", 4), fix: field(form, "fix", 64), box: field(form, "box", 80), figure: field(form, "figure", 20),
    }, actorId);
  });
}
