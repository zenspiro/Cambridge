import { getAuth } from "@/lib/account/server";

/** Better Auth answers only the Google callback here; its other endpoints are not exposed (we call auth.api.*). */
const ALLOWED = new Set(["/api/auth/callback/google"]);

export async function GET(request: Request) {
  if (!ALLOWED.has(new URL(request.url).pathname)) return new Response("Not found", { status: 404 });
  const auth = await getAuth(request.headers);
  if (!auth) return new Response("Not found", { status: 404 });
  return auth.handler(request);
}
