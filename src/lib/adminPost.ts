import { adminSession } from "@/lib/auth/guard";
import { LIBRARY } from "@/lib/config";
import type { Db } from "@/lib/db";
import { getEnv, type AppEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";

/**
 * Common shape of every admin form POST: same origin, admin session, rate limit,
 * then the action, then a 303 back to `back` with a message code (or a path).
 * The action returns either a code ("ok_added") or a full same-site path ("/admin/...").
 */
export async function adminPost(
  request: Request,
  back: string,
  act: (ctx: { db: Db; env: AppEnv; form: FormData; actorId: string }) => Promise<string>,
): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await adminSession();
  if (!session) return redirectTo(request, "/admin/login");
  try {
    const env = await getEnv();
    if (!(await allow(env.DB, await limitKey("admin-write", session.actorId), LIBRARY.writesPerHour, 3_600_000))) {
      return redirectTo(request, `${back}?e=busy`);
    }
    const out = await act({ db: env.DB, env, form: await request.formData(), actorId: session.actorId });
    return redirectTo(request, out.startsWith("/") ? out : `${back}?e=${out}`);
  } catch (err) {
    const ref = reportError(`admin.post ${back}`, err);
    return redirectTo(request, `${back}?ref=${ref}`);
  }
}

export function formId(form: FormData, name = "id"): string | null {
  const id = form.get(name);
  return typeof id === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null;
}
