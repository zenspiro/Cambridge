import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { forgetReadings, moveDocument, removeDocument } from "@/lib/library/store";
import { getLibrarySettings, libraryYears } from "@/lib/settings";

// Move or remove a stored file (owner, 12 Nov 2026: "I uploaded the examiner report of the wrong month and there is no
// way to update it or remove it"). Move: the same file under another exam session's name (type, paper and variant
// kept); the new place must be free. Remove: the file, its row, its readings and fixes. The owner (or the whole
// admin to edit) only; the file is named by the page's id, never by the form. Not while an AI run is reading it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = /^[A-Za-z0-9_-]{10,64}$/.test(id);
  const back = ok ? `/admin/library/review/${id}` : "/admin/library";
  return staffPost(request, back, ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    if (!ok) return "bad";
    const row = await db.prepare(`SELECT syllabus_id FROM source_document WHERE id = ?1 AND status = 'stored'`).bind(id).first<{ syllabus_id: string }>();
    if (!row) return "gone";
    const reading = await db
      .prepare(`SELECT 1 AS n FROM job WHERE type = 'brain' AND status IN ('queued', 'running') AND instr(params, ?1) > 0 LIMIT 1`)
      .bind(id)
      .first();
    if (reading) return "file_busy";
    if (form.get("do") === "move") {
      const session = form.get("session");
      const year = Number(form.get("year"));
      if (session !== "m" && session !== "s" && session !== "w") return "bad";
      if (!libraryYears(await getLibrarySettings(db)).includes(year)) return "year";
      const r = await moveDocument(db, env.SOURCE, id, session, year, actorId);
      return r === "ok_renamed" ? "ok_moved" : r;
    }
    if (form.get("do") === "remove") {
      const r = await removeDocument(db, env.SOURCE, id, actorId);
      if (r !== "ok_removed") return r;
      await forgetReadings(env.FILES, id);
      const code = row.syllabus_id.slice(0, 4);
      return `/admin/library/${/^[0-9]{4}$/.test(code) ? `${code}/documents` : ""}?e=ok_removed`;
    }
    return "bad";
  });
}
