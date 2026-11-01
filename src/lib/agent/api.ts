// The agent's side door into the Worker: every request must carry a valid signature,
// a fresh timestamp and an unused nonce. Anything else gets a bare 401.
import type { Db } from "../db.ts";
import { getEnv, type AppEnv } from "../env.ts";
import { reportError } from "../errors.ts";
import { verifyRequest } from "./sign.ts";
import { spendNonce } from "./runs.ts";

const MAX_JSON_BYTES = 512 * 1024;

export async function agentRequest(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<{ ok: true; env: AppEnv; db: Db; body: Uint8Array } | { ok: false; response: Response }> {
  const deny = (status = 401) => ({ ok: false as const, response: new Response(null, { status, headers: { "Cache-Control": "no-store" } }) });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > maxBytes) return deny(413);
  const env = await getEnv();
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > maxBytes) return deny(413);
  const path = new URL(request.url).pathname;
  const v = await verifyRequest(env.AGENT_SECRET, request.method, path, body, request.headers);
  if (!v.ok) {
    if (v.reason === "secret") reportError("agent.auth", new Error("AGENT_SECRET missing or too short"));
    return deny();
  }
  if (!(await spendNonce(env.DB, v.nonce))) return deny();
  return { ok: true, env, db: env.DB, body };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function parseJson(body: Uint8Array): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(body));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const JOB_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
