import { accountSession } from "@/lib/account/server";
import { getEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { acceptInvite } from "@/lib/auth/team";

// Accept a team invite (owner, 9 Nov 2026): the signed-in person, with the invited and verified email, once. Then to
// the admin.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const { token } = await params;
  const back = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? `/team/join/${token}` : "/signin";
  const s = await accountSession();
  if (!s) return redirectTo(request, `/signin?next=${encodeURIComponent(back)}`);
  try {
    const r = await acceptInvite((await getEnv()).DB, token, { id: s.userId, email: s.email });
    return redirectTo(request, r === "ok" ? "/admin" : `${back}?e=${r}`);
  } catch (err) {
    return redirectTo(request, `${back}?ref=${reportError("team.accept", err)}`);
  }
}
