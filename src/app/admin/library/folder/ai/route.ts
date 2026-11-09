import { allowed, staffFor } from "@/lib/auth/staff";
import { aiJudge } from "@/lib/agent/aiTask";
import { makeModelRun } from "@/lib/agent/model";
import { LIBRARY } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { isSameOrigin } from "@/lib/http";
import { listSubjects } from "@/lib/library/catalog";
import { allow, limitKey } from "@/lib/ratelimit";
import { getLibrarySettings } from "@/lib/settings";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Folder upload: the page asks the AI about files neither the rules nor the first page could
// place. Same prompts and checks as the agent; the scope is one subject, every library year.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const session = await staffFor({ area: "library", level: "edit" });
  if (!session) return json({ error: "signed_out" }, 401);
  if (Number(request.headers.get("content-length") ?? "0") > 64 * 1024) return json({ error: "bad_request" }, 400);
  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (body?.task !== "names" && body?.task !== "cover") return json({ error: "bad_request" }, 400);
  const env = await getEnv();
  const code = body.code;
  if (typeof code !== "string" || !(await listSubjects(env.DB)).some((s) => s.code === code)) return json({ error: "bad_request" }, 400);
  if (!allowed(session, { area: "library", level: "edit", code })) return json({ error: "no_access" }, 403);
  const run = makeModelRun(env.AI as never, env.AI_MODEL, "library.folder.ai", env.DB);
  if (!run) return json({ error: "ai_unavailable" }, 503);
  if (!(await allow(env.DB, await limitKey("folder-ai", session.actorId), LIBRARY.folderAiPerHour, 3_600_000))) return json({ error: "limit" }, 429);
  const lib = await getLibrarySettings(env.DB);
  const years: number[] = [];
  for (let y = lib.toYear; y >= lib.fromYear; y--) years.push(y);
  const r = await aiJudge(env.DB, { code, years, sessions: ["m", "s", "w", "y"], mode: "download" }, body, run);
  return r.ok ? json(r.data) : json({ error: r.error }, r.status);
}
