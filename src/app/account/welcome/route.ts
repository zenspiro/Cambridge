import { accountSession } from "@/lib/account/server";
import { checkWelcome, homeFor, saveWelcome } from "@/lib/account/roles";
import { checkDetails, saveDetails, standing } from "@/lib/account/profile";
import { getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

/** The welcome step: student or parent, first and last name, country, and a student's birth year. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const s = await accountSession();
  if (!s) return redirectTo(request, "/signin");
  try {
    const form = await request.formData();
    const w = checkWelcome({ role: form.get("role"), firstName: form.get("firstName"), lastName: form.get("lastName") });
    const d = w && checkDetails({ country: form.get("country"), birthYear: form.get("birthYear") }, w.role === "student", new Date().getUTCFullYear());
    if (!w || !d) return redirectTo(request, "/welcome?e=bad");
    const db = (await getEnv()).DB;
    await saveWelcome(db, s.userId, w);
    await saveDetails(db, s.userId, d);
    await audit(db, { actorId: s.userId, action: "account.welcome", entity: "account", entityId: s.userId, detail: { role: w.role } });
    const roles = [...s.roles, w.role];
    return redirectTo(request, homeFor(roles, await standing(db, s.userId, roles)));
  } catch (err) {
    return redirectTo(request, `/welcome?ref=${reportError("account.welcome", err)}`);
  }
}
