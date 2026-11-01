// Request helpers. No Next imports, so Node tests can load this file.

/**
 * True when a POST comes from our own pages (CSRF guard on top of SameSite cookies).
 * Browsers send Origin on every POST form submit.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The visitor's network, used only as a hashed rate-limit key. */
export function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

/** 303 redirect to a same-site path only (brief 15.2). */
export function redirectTo(request: Request, path: string, headers?: HeadersInit): Response {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
  const h = new Headers(headers);
  h.set("Location", new URL(safe, request.url).toString());
  h.set("Cache-Control", "no-store");
  return new Response(null, { status: 303, headers: h });
}
