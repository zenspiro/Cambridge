// Common shape of every signed-in student or parent form POST (like adminPost): same origin, a session, a rate limit
// per person, then the action, then a 303 back with a fixed message code (or to a path the action returns).
import { ACCOUNT_WRITES_PER_HOUR } from "@/lib/config";
import type { Db } from "@/lib/db";
import { getEnv, type AppEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";
import { accountSession, type AccountSession } from "./server.ts";

export async function accountPost(
  request: Request,
  back: string,
  act: (ctx: { db: Db; env: AppEnv; form: FormData; session: AccountSession }) => Promise<string>,
): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await accountSession();
  if (!session) return redirectTo(request, "/signin");
  try {
    const env = await getEnv();
    if (!(await allow(env.DB, await limitKey("account-write", session.userId), ACCOUNT_WRITES_PER_HOUR, 3_600_000))) {
      return redirectTo(request, `${back}?e=busy`);
    }
    const out = await act({ db: env.DB, env, form: await request.formData(), session });
    return redirectTo(request, out.startsWith("/") ? out : `${back}?e=${out}`);
  } catch (err) {
    return redirectTo(request, `${back}?ref=${reportError(`account.post ${back}`, err)}`);
  }
}
