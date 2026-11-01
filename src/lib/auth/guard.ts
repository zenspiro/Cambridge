import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { findSession } from "./session.ts";

/** For admin route handlers: the signed-in admin and their token, or null. */
export async function adminSession(): Promise<{ actorId: string; token: string } | null> {
  const env = await getEnv();
  const token = (await cookies()).get(AUTH.cookieName)?.value;
  const s = await findSession(env.DB, token);
  return s && token ? { actorId: s.actorId, token } : null;
}

/** Call first in every admin page. Sends a signed-out visitor to the sign-in page. */
export async function requireAdmin(): Promise<{ actorId: string }> {
  const s = await adminSession();
  if (!s) redirect("/admin/login");
  return { actorId: s.actorId };
}
