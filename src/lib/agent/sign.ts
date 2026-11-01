// Signed requests between the agent (GitHub Actions) and the Worker (brief 15.2:
// verify signature and timestamp, block replays). Web Crypto only, no imports:
// used by the Worker and by scripts/agent/run.ts in Node.

export const SIG_HEADERS = { ts: "x-agent-ts", nonce: "x-agent-nonce", sig: "x-agent-sig" } as const;
export const MAX_SKEW_MS = 5 * 60_000;
export const MIN_SECRET_LENGTH = 32;
const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;

const enc = new TextEncoder();

async function hex(buf: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function bodyHash(body: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", body as BufferSource));
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

function canonical(ts: string, nonce: string, method: string, path: string, hash: string): string {
  return [ts, nonce, method.toUpperCase(), path, hash].join("\n");
}

function newNonce(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signRequest(secret: string, method: string, path: string, body: Uint8Array, now = Date.now()) {
  const ts = String(now);
  const nonce = newNonce();
  const sig = await hmac(secret, canonical(ts, nonce, method, path, await bodyHash(body)));
  return { [SIG_HEADERS.ts]: ts, [SIG_HEADERS.nonce]: nonce, [SIG_HEADERS.sig]: sig };
}

export type VerifyResult = { ok: true; nonce: string; ts: number } | { ok: false; reason: "secret" | "headers" | "time" | "signature" };

/** Checks the signature and the clock. The caller must also spend the nonce once (replay guard). */
export async function verifyRequest(
  secret: string | undefined,
  method: string,
  path: string,
  body: Uint8Array,
  headers: Headers,
  now = Date.now(),
): Promise<VerifyResult> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "secret" };
  const ts = headers.get(SIG_HEADERS.ts) ?? "";
  const nonce = headers.get(SIG_HEADERS.nonce) ?? "";
  const sig = headers.get(SIG_HEADERS.sig) ?? "";
  if (!/^\d{13}$/.test(ts) || !NONCE_RE.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "headers" };
  if (Math.abs(now - Number(ts)) > MAX_SKEW_MS) return { ok: false, reason: "time" };
  const want = await hmac(secret, canonical(ts, nonce, method, path, await bodyHash(body)));
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { ok: true, nonce, ts: Number(ts) } : { ok: false, reason: "signature" };
}
