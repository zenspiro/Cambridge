import { accountSession } from "@/lib/account/server";
import { checkWelcome, homeFor, saveWelcome } from "@/lib/account/roles";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

/** The welcome step: student or parent, first and last name. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const s = await accountSession();
  if (!s) return redirectTo(request, "/signin");
  try {
    const form = await request.formData();
    const w = checkWelcome({ role: form.get("role"), firstName: form.get("firstName"), lastName: form.get("lastName") });
    if (!w) return redirectTo(request, "/welcome?e=bad");
    const db = (await getEnv()).DB;
    await saveWelcome(db, s.userId, w);
    await audit(db, { actorId: s.userId, action: "account.welcome", entity: "account", entityId: s.userId, detail: { role: w.role } });
    return redirectTo(request, homeFor([...s.roles, w.role]));
  } catch (err) {
    return redirectTo(request, `/welcome?ref=${reportError("account.welcome", err)}`);
  }
}
