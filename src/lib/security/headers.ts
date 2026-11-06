// Security headers for every response (brief 15.2).
// Pure functions with no imports, so Node tests can load this file directly.

/** Headers sent on every response, pages and API alike. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const NONCE_RE = /^[A-Za-z0-9+/]{22,}={0,2}$/;

/** A fresh random nonce (128 bits, base64) for one response. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Content Security Policy. Scripts and style elements need the per-request nonce.
 * Any outside host must be added here explicitly (brief 15.4).
 * Dev mode allows eval and inline styles because React dev tools and hot reload need them.
 */
export function buildCsp(nonce: string, opts: { dev?: boolean; plainHttp?: boolean; framesSelf?: boolean } = {}): string {
  if (!NONCE_RE.test(nonce)) throw new Error("invalid CSP nonce");
  const dev = opts.dev === true;
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    // Only the admin review screen frames our own PDF (owner, 6 Nov 2026); every other page frames nothing.
    "frame-src": opts.framesSelf ? ["'self'"] : ["'none'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "base-uri": ["'none'"],
    // Google sign-in: the "Continue with Google" form is answered with a redirect to Google's sign-in page.
    "form-action": ["'self'", "https://accounts.google.com"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  // Only meaningful over https. On a local http test server it would send the page's
  // own background requests to https://localhost and break them.
  if (!dev && !opts.plainHttp) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** The review screen (frames our own PDF) and the inline PDF it frames: the only exceptions to "no framing". */
export const REVIEW_PAGE_RE = /^\/admin\/library\/review\/[A-Za-z0-9_-]{10,64}$/;
export const PDF_VIEW_RE = /^\/admin\/library\/file\/[A-Za-z0-9_-]{10,64}\/view$/;

/** The inline PDF's own policy: it loads nothing, and only our own pages may frame it. */
export const PDF_VIEW_CSP = "default-src 'none'; frame-ancestors 'self'";
