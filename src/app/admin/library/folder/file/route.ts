import { allowed, mainCode, staffFor } from "@/lib/auth/staff";
import { parseCambridgeName } from "@/lib/library/names";
import { LIBRARY } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";
import { storeDocument } from "@/lib/library/store";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Folder upload: one PDF at a time, under the Cambridge name the page worked out. Admin only,
// same origin, rate limited; stored through the same checks as every other upload.
// Every answer is JSON, even when something unexpected fails, so the page can say what happened
// and try again instead of showing a bare error.
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (err) {
    const ref = reportError("library.folder", err);
    return json({ fileName: (request.headers.get("x-file-name") ?? "").slice(0, 40), ok: false, reason: "storage", ref }, 500);
  }
}

async function handle(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const session = await staffFor({ area: "library", level: "edit" });
  if (!session) return json({ error: "signed_out" }, 401);
  const name = request.headers.get("x-file-name") ?? "";
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!/^[a-z0-9_]{6,40}\.pdf$/.test(name) || !Number.isFinite(length) || length > LIBRARY.maxFileBytes) return json({ fileName: name.slice(0, 40), ok: false, reason: "size" }, 400);
  const env = await getEnv();
  if (!(await allow(env.DB, await limitKey("folder-file", session.actorId), LIBRARY.folderFilesPerHour, 3_600_000))) return json({ error: "busy" }, 429);
  const p = parseCambridgeName(name);
  if (p && !allowed(session, { area: "library", level: "edit", code: await mainCode(env.DB, p.code) })) return json({ fileName: name, ok: false, reason: "no_access" }, 403);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > LIBRARY.maxFileBytes) return json({ fileName: name, ok: false, reason: "size" }, 400);
    return json(await storeDocument(env.DB, env.SOURCE, { fileName: name, bytes, actorId: session.actorId, origin: "upload" }));
  } catch (err) {
    const ref = reportError("library.folder", err);
    return json({ fileName: name, ok: false, reason: "storage", ref }, 500);
  }
}
