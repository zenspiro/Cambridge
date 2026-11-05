import { accountSession, getAuth } from "@/lib/account/server";
import { withCookies } from "@/lib/account/http";
import { deleteAccount } from "@/lib/account/profile";
import { getEnv } from "@/lib/env";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

/** "Delete my account": every row it owns goes (cascade); the cookie is cleared. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const s = await accountSession();
  if (!s) return redirectTo(request, "/signin");
  try {
    const auth = await getAuth(request.headers);
    let cleared = new Headers();
    if (auth) cleared = withCookies((await auth.api.signOut({ headers: request.headers, returnHeaders: true })).headers, new Headers());
    await deleteAccount((await getEnv()).DB, s.userId, s.userId);
    return redirectTo(request, "/signin?e=ok_deleted", cleared);
  } catch (err) {
    return redirectTo(request, `/me?ref=${reportError("account.delete", err)}`);
  }
}
