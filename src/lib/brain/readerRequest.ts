import { getEnv, type AppEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import type { Db } from "@/lib/db";
import { READER_MIN_TOKEN, tokenMatches } from "./reader";

/** A request to /api/reader/*: the bearer key checked, then the JSON body (see reader.ts). */
export async function readerRequest(request: Request, maxBytes: number): Promise<{ ok: true; env: AppEnv; db: Db; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const deny = (status: number) => ({ ok: false as const, response: new Response(null, { status, headers: { "Cache-Control": "no-store" } }) });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > maxBytes) return deny(413);
  const env = await getEnv();
  if (!env.READER_TOKEN || env.READER_TOKEN.length < READER_MIN_TOKEN) {
    if (env.READER_TOKEN) reportError("reader.auth", new Error("READER_TOKEN too short"));
    return deny(404);
  }
  if (!(await tokenMatches(env.READER_TOKEN, request.headers.get("authorization")))) return deny(401);
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > maxBytes) return deny(413);
  try {
    const v = JSON.parse(new TextDecoder().decode(raw));
    if (!v || typeof v !== "object" || Array.isArray(v)) return deny(400);
    return { ok: true, env, db: env.DB, body: v as Record<string, unknown> };
  } catch {
    return deny(400);
  }
}
