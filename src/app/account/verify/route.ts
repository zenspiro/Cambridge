import { APIError } from "better-auth/api";
import { ACCOUNT } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { getAuth } from "@/lib/account/server";
import { cleanCode, cleanEmail, getRoles, homeFor } from "@/lib/account/roles";
import { accountJson, json, underLimits, withCookies } from "@/lib/account/http";

/** Better Auth's reasons, in our fixed codes. */
function reason(err: unknown): string {
  const code = err instanceof APIError ? String((err.body as { code?: string } | undefined)?.code ?? "") : "";
  if (code === "OTP_EXPIRED") return "expired";
  if (code === "TOO_MANY_ATTEMPTS") return "too_many";
  return "bad_code";
}

/** Step 2 of signing in: check the code, start the session (cookie), and say where to go next. */
export async function POST(request: Request) {
  return accountJson(request, "account.verify", async (body) => {
    const auth = await getAuth(request.headers);
    if (!auth) return json({ error: "closed" });
    const email = cleanEmail(body.email);
    const code = cleanCode(body.code);
    if (!email || !code) return json({ error: "bad_code" });
    if (!(await underLimits(request, "check", email, ACCOUNT.checksPerEmailPerHour, ACCOUNT.checksPerNetworkPerHour))) return json({ error: "busy" });
    let result: { headers: Headers; response: { user: { id: string } } };
    try {
      result = await auth.api.signInEmailOTP({ body: { email, otp: code }, headers: request.headers, returnHeaders: true });
    } catch (err) {
      if (err instanceof APIError) return json({ error: reason(err) });
      throw err;
    }
    const next = homeFor(await getRoles((await getEnv()).DB, result.response.user.id));
    return json({ ok: true, next }, { headers: withCookies(result.headers, new Headers()) });
  });
}
