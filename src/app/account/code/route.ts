import { ACCOUNT } from "@/lib/config";
import { getAuth } from "@/lib/account/server";
import { cleanEmail } from "@/lib/account/roles";
import { accountJson, json, underLimits } from "@/lib/account/http";
import { reportError } from "@/lib/errors";

/**
 * Step 1 of signing in: send a code to an email address. The answer is the same whether or not an account exists
 * (a first sign-in creates the account), so nobody can test which addresses are registered.
 */
export async function POST(request: Request) {
  return accountJson(request, "account.code", async (body) => {
    const auth = await getAuth(request.headers);
    if (!auth) return json({ error: "closed" });
    const email = cleanEmail(body.email);
    if (!email) return json({ error: "bad_email" });
    if (!(await underLimits(request, "code", email, ACCOUNT.codesPerEmailPerHour, ACCOUNT.codesPerNetworkPerHour))) return json({ error: "busy" });
    try {
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
    } catch (err) {
      return json({ error: "not_sent", ref: reportError("account.code.send", err) });
    }
    return json({ ok: true });
  });
}
