import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS, buildCsp, makeNonce } from "@/lib/security/headers";

// Runs before every page and API route. Sets a per-request CSP nonce (Next reads it
// from the request header and adds it to its own scripts) and the security headers.
// Static files are covered by public/_headers instead.
// Next 16 calls this file "proxy", but its Node version is experimental on OpenNext
// Cloudflare, so we keep the supported edge middleware until that changes.
export function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
