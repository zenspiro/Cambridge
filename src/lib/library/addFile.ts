import { mainCode, staffPost } from "@/lib/auth/staff";
import { redirectTo } from "@/lib/http";
import { LIBRARY } from "@/lib/config";
import { allow, limitKey } from "@/lib/ratelimit";
import type { Db } from "@/lib/db";
import type { AppEnv } from "@/lib/env";
import { parseCambridgeName } from "./names";

/**
 * Shared POST shape for adding one missing file: staff checks (staffPost: library edit for the file's subject), size guard,
 * the upload rate limit, and a target that must be a Cambridge file name. On success
 * the admin goes back to the subject page; otherwise back to the add page with a reason.
 */
export async function addFilePost(
  request: Request,
  act: (ctx: { db: Db; env: AppEnv; form: FormData; actorId: string; target: string }) => Promise<{ ok: true } | { ok: false; reason: string }>,
): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > LIBRARY.maxFileBytes + 64 * 1024) {
    return redirectTo(request, "/admin/library?e=too_big");
  }
  return staffPost(request, "/admin/library", { area: "library", level: "edit" }, async ({ db, env, form, actorId, check }) => {
    const p = parseCambridgeName(String(form.get("target") ?? ""));
    if (!p) return "/admin/library";
    if (!check({ area: "library", level: "edit", code: await mainCode(db, p.code) })) return "/admin/library?e=no_access";
    const back = (e: string) => `/admin/library/add?file=${encodeURIComponent(p.fileName)}&e=${e}`;
    if (!(await allow(db, await limitKey("upload", actorId), LIBRARY.uploadsPerHour, 3_600_000))) return back("busy");
    const r = await act({ db, env, form, actorId, target: p.fileName });
    return r.ok ? `/admin/library/${p.code}?e=ok_added` : back(r.reason);
  });
}
