// Errors (brief 15.2): visitors only ever see a reference id. Details go to the logs.
// No imports, so Node tests can load this file directly.

const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O, 1/I/L, U

/** A short random reference id, e.g. "K7PQ-3XMA". */
export function newErrorRef(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
    if (i === 3) out += "-";
  }
  return out;
}

/**
 * Log an error with its reference id as one JSON line (Workers Logs picks it up).
 * Never pass user input or secrets in `where`. Returns the ref for the response.
 */
export function reportError(where: string, err: unknown, ref: string = newErrorRef()): string {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error(
      JSON.stringify({ level: "error", ref, where, name: e.name, message: e.message, stack: e.stack }),
    );
  } catch {
    // Logging must never throw.
  }
  return ref;
}

/** The only error body a visitor gets. */
export function publicErrorBody(ref: string): { ok: false; error: string; ref: string } {
  return { ok: false, error: "Something went wrong. Please quote this reference if you contact us.", ref };
}
