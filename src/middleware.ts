import { NextResponse, type NextRequest } from "next/server";
import { PDF_VIEW_CSP, PDF_VIEW_RE, REVIEW_PAGE_RE, SECURITY_HEADERS, buildCsp, makeNonce } from "@/lib/security/headers";
import { ACCOUNT, AUTH } from "@/lib/config";

// Runs before every page and API route. Sets a per-request CSP nonce (Next reads it
// from the request header and adds it to its own scripts) and the security headers.
// Static files are covered by public/_headers instead.
// Next 16 calls this file "proxy", but its Node version is experimental on OpenNext
// Cloudflare, so we keep the supported edge middleware until that changes.

// Admin paths open without a cookie. Every other /admin path also checks the
// session in D1 itself (requireAdmin, requireStaff); this is only an early, cheap turn-away. Team members
// (owner, 9 Nov 2026) come with the email sign-in's cookie instead of the admin one.
const ADMIN_OPEN = new Set(["/admin/login", "/admin/session"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  const plainHttp = request.nextUrl.protocol === "http:";

  const hasSession = request.cookies.has(AUTH.cookieName) || request.cookies.getAll().some((c) => c.name.endsWith(`${ACCOUNT.cookiePrefix}.session_token`));
  if (isAdmin && !ADMIN_OPEN.has(pathname) && !hasSession && request.method === "GET") {
    return withHeaders(NextResponse.redirect(new URL("/admin/login", request.url), 303), makeNonce(), true, plainHttp);
  }

  const nonce = makeNonce();
  const framesSelf = REVIEW_PAGE_RE.test(pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp(nonce, plainHttp, framesSelf));
  const response = withHeaders(NextResponse.next({ request: { headers: requestHeaders } }), nonce, isAdmin, plainHttp, framesSelf);
  if (PDF_VIEW_RE.test(pathname)) {
    // The inline PDF for the review screen: framed by our own pages only.
    response.headers.set("Content-Security-Policy", PDF_VIEW_CSP);
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  return response;
}

function csp(nonce: string, plainHttp: boolean, framesSelf = false): string {
  return buildCsp(nonce, { dev: process.env.NODE_ENV === "development", plainHttp, framesSelf });
}

function withHeaders(response: NextResponse, nonce: string, noStore: boolean, plainHttp: boolean, framesSelf = false): NextResponse {
  response.headers.set("Content-Security-Policy", csp(nonce, plainHttp, framesSelf));
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  if (noStore) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
