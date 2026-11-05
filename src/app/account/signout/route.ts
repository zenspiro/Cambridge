import { accountSession, getAuth } from "@/lib/account/server";
import { withCookies } from "@/lib/account/http";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

/** Signs the student or parent out: the session row is removed and the cookie cleared. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const s = await accountSession();
  const auth = await getAuth(request.headers);
  if (!s || !auth) return redirectTo(request, "/signin");
  try {
    const r = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    await audit((await getEnv()).DB, { actorId: s.userId, action: "account.signout", entity: "account", entityId: s.userId });
    return redirectTo(request, "/signin?e=ok_out", withCookies(r.headers, new Headers()));
  } catch (err) {
    reportError("account.signout", err);
    return redirectTo(request, "/signin");
  }
}
