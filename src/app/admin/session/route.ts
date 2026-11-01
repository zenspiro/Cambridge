import { AUTH } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { newErrorRef, reportError } from "@/lib/errors";
import { clientKey, isSameOrigin, redirectTo } from "@/lib/http";
import { signIn } from "@/lib/auth/session";

// Sign-in form POST. Public by design (listed in src/lib/access.ts):
// same-origin only, rate limited per network, audited.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const env = await getEnv();
    const form = await request.formData();
    const result = await signIn(env.DB, {
      password: form.get("password"),
      adminPass: env.ADMIN_PASS,
      clientKey: clientKey(request),
    });
    if (!result.ok) {
      if (result.reason === "unavailable") reportError("admin.signin", new Error("ADMIN_PASS missing or too short"));
      return redirectTo(request, `/admin/login?e=${result.reason}`);
    }
    const maxAge = Math.floor((result.expiresAt - Date.now()) / 1000);
    return redirectTo(request, "/admin", {
      "Set-Cookie": `${AUTH.cookieName}=${result.token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`,
    });
  } catch (err) {
    reportError("admin.signin", err, newErrorRef());
    return redirectTo(request, "/admin/login?e=unavailable");
  }
}
