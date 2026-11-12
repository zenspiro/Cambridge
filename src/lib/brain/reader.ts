/**
 * The door for readings made in a dev session (owner, 12 Nov 2026: "you are going to read the pdfs and load them in
 * to the database, with me reviewing"). The Worker secret READER_TOKEN (32+ characters) must come as a bearer token;
 * the session's network proxy adds it, so the value is never in the session. Without the secret the door is shut.
 * It only saves paper readings, through the same checks as the AI's.
 */
export const READER_MIN_TOKEN = 32;

const enc = new TextEncoder();
async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Same length digests compared in full, so the time taken says nothing about the token. */
export async function tokenMatches(secret: string | undefined, header: string | null): Promise<boolean> {
  if (!secret || secret.length < READER_MIN_TOKEN || !header) return false;
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return false;
  const [a, b] = await Promise.all([digest(secret), digest(m[1]!)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
