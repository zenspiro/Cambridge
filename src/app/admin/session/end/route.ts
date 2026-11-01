import { AUTH } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { adminSession } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/session";

const CLEAR = `${AUTH.cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

// Sign-out POST. Needs a live admin session.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const session = await adminSession();
    if (session) await signOut((await getEnv()).DB, session.token);
  } catch (err) {
    reportError("admin.signout", err);
  }
  return redirectTo(request, "/admin/login", { "Set-Cookie": CLEAR });
}
