// Shared shape of the sign-in route handlers (before a session exists): same origin, the visitor's network for
// rate limits, JSON answers with a fixed code (never free text), errors as a reference only.
import { getEnv } from "@/lib/env";
import { clientKey, isSameOrigin } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";
import { reportError } from "@/lib/errors";

export function json(body: Record<string, string | boolean>, init?: { status?: number; headers?: Headers }): Response {
  const h = init?.headers ?? new Headers();
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: h });
}

/** Both limits must pass: per email address and per network. Keys are hashed (no raw emails or IPs stored). */
export async function underLimits(request: Request, kind: string, email: string, perEmail: number, perNetwork: number): Promise<boolean> {
  const db = (await getEnv()).DB;
  const hour = 3_600_000;
  const a = await allow(db, await limitKey(`${kind}-email`, email), perEmail, hour);
  const b = await allow(db, await limitKey(`${kind}-net`, clientKey(request)), perNetwork, hour);
  return a && b;
}

/** Runs a JSON sign-in step: same origin first, any unexpected error becomes { error: "failed", ref }. */
export async function accountJson(request: Request, where: string, act: (body: Record<string, unknown>) => Promise<Response>): Promise<Response> {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: "bad_request" }, { status: 400 });
  }
  try {
    return await act(body);
  } catch (err) {
    return json({ error: "failed", ref: reportError(where, err) });
  }
}

/** Copies the session cookies Better Auth set onto our own response. */
export function withCookies(from: Headers, to: Headers): Headers {
  for (const c of from.getSetCookie()) to.append("Set-Cookie", c);
  return to;
}
