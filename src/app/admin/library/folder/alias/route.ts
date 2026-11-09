import { ADMIN_EDIT, staffFor } from "@/lib/auth/staff";
import { audit } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { isSameOrigin } from "@/lib/http";
import { learnAlias } from "@/lib/library/alias";
import { allow, limitKey } from "@/lib/ratelimit";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Folder upload: a cover printed a code the library does not have next to a library subject's
// name ("PHYSICS 1524/12, May/June 2021"). The code is linked to that subject's syllabus so its
// files come in under their own names. Only a code with exactly one matching subject is linked.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  // Linking a new code changes the library for everyone: the owner, or a team member with the whole admin to edit.
  const session = await staffFor(ADMIN_EDIT);
  if (!session) return json({ error: "signed_out" }, 401);
  if (Number(request.headers.get("content-length") ?? "0") > 4 * 1024) return json({ error: "bad_request" }, 400);
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const env = await getEnv();
  if (!(await allow(env.DB, await limitKey("folder-alias", session.actorId), 30, 3_600_000))) return json({ error: "limit" }, 429);
  const r = await learnAlias(env.DB, {
    code: String(body?.code ?? ""), subjectWord: String(body?.subjectWord ?? ""), mainCode: String(body?.mainCode ?? ""),
    label: String(body?.label ?? ""), year: Number(body?.year), session: String(body?.session ?? ""),
  });
  if (!r.ok) return json({ error: r.reason }, r.reason === "bad" ? 400 : 409);
  await audit(env.DB, { actorId: session.actorId, action: "library.alias", entity: "syllabus_alias", entityId: r.alias.code, detail: { main: r.alias.main_code } });
  return json({ alias: r.alias });
}
