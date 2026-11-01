import { adminSession } from "@/lib/auth/guard";
import { LIBRARY } from "@/lib/config";
import type { Db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";

/** Common checks for every source-site POST: same origin, admin, rate limit, errors. */
export async function sourcePost(
  request: Request,
  act: (db: Db, form: FormData, actorId: string) => Promise<string>,
): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const session = await adminSession();
  if (!session) return redirectTo(request, "/admin/login");
  try {
    const env = await getEnv();
    if (!(await allow(env.DB, await limitKey("admin-write", session.actorId), LIBRARY.writesPerHour, 3_600_000))) {
      return redirectTo(request, "/admin/sources?e=busy");
    }
    const code = await act(env.DB, await request.formData(), session.actorId);
    return redirectTo(request, `/admin/sources?e=${code}`);
  } catch (err) {
    const ref = reportError("sources.post", err);
    return redirectTo(request, `/admin/sources?ref=${ref}`);
  }
}

export function formId(form: FormData): string | null {
  const id = form.get("id");
  return typeof id === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null;
}
