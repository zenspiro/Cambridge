// Student and parent sessions in pages and route handlers. Pages call requireAccount() or requireRole() first,
// route handlers call accountSession() (the access test checks this).
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ACCOUNT, type AccountRole, type ThemeId } from "@/lib/config";
import { currentBrand, getEnv } from "@/lib/env";
import { audit } from "@/lib/auth/session";
import { reportError } from "@/lib/errors";
import { makeAuth, type Auth } from "./auth.ts";
import { codeEmail, sendEmail } from "./email.ts";
import { getRoles, homeFor } from "./roles.ts";
import { getProfile, standing, type Standing } from "./profile.ts";

/** The site's own address, from the request (http only for a local test server). */
export function originOf(h: Headers): string {
  const host = h.get("host") ?? "localhost";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

export const isLocalHost = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

/** True when student and parent sign-in can work: the session secret is set and long enough. */
export async function accountsReady(): Promise<boolean> {
  return ((await getEnv()).BETTER_AUTH_SECRET ?? "").length >= ACCOUNT.minSecretLength;
}

export async function googleReady(): Promise<boolean> {
  const env = await getEnv();
  return Boolean(env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET);
}

/** Better Auth for this request, or null when the secret is missing (sign-in then says it is not open yet). */
export async function getAuth(h?: Headers): Promise<Auth | null> {
  const env = await getEnv();
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < ACCOUNT.minSecretLength) return null;
  const origin = originOf(h ?? (await headers()));
  const brand = await currentBrand();
  const local = env.EMAIL_TRANSPORT === "local" && isLocalHost(origin);
  return makeAuth({
    database: env.DB,
    secret,
    baseURL: origin,
    appName: brand.name,
    google: env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET ? { clientId: env.OAUTH_CLIENT_ID, clientSecret: env.OAUTH_CLIENT_SECRET } : undefined,
    sendCode: async (email, code) => {
      const r = await sendEmail(codeEmail(brand.name, email, code), { platform: brand.name, from: brand.emailFrom, apiKey: env.RESEND, local, bucket: env.FILES });
      if (r !== "sent") throw new Error(`sign-in code not sent: ${r}`);
    },
    audit: async (action, userId) => {
      const work = audit(env.DB, { actorId: userId, action, entity: "account", entityId: userId }).catch((e) => reportError("account.audit", e));
      try {
        getCloudflareContext().ctx.waitUntil(work);
      } catch {
        await work;
      }
    },
  });
}

export type AccountSession = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: AccountRole[];
  /** Students: "details" or "pending" until their details are in and a parent approved (when needed). */
  standing: Standing;
  /** The theme the person picked, or null (the Brand page's default then applies). */
  theme: ThemeId | null;
};

/** The signed-in student or parent, or null. */
export async function accountSession(): Promise<AccountSession | null> {
  const h = await headers();
  const auth = await getAuth(h);
  if (!auth) return null;
  try {
    const s = await auth.api.getSession({ headers: h });
    if (!s) return null;
    const u = s.user as typeof s.user & { firstName?: string | null; lastName?: string | null };
    const db = (await getEnv()).DB;
    const roles = await getRoles(db, u.id);
    const [st, p] = await Promise.all([standing(db, u.id, roles), getProfile(db, u.id)]);
    return { userId: u.id, email: u.email, firstName: u.firstName ?? "", lastName: u.lastName ?? "", roles, standing: st, theme: p.theme };
  } catch (err) {
    reportError("account.session", err);
    return null;
  }
}

/** Call first in pages for any signed-in person (the welcome step). Signed out: to the sign-in page. */
export async function requireAccount(): Promise<AccountSession> {
  const s = await accountSession();
  if (!s) redirect("/signin");
  return s;
}

/**
 * Call first in a role's pages. Without that role: to the person's own home (or the welcome step). A student who is
 * still waiting (details missing or a parent's approval) only reaches pages that pass `waiting: true`.
 */
export async function requireRole(role: AccountRole, opts: { waiting?: boolean } = {}): Promise<AccountSession> {
  const s = await requireAccount();
  if (!s.roles.includes(role)) redirect(homeFor(s.roles, s.standing));
  if (role === "student" && s.standing !== "ok" && !opts.waiting) redirect(homeFor(s.roles, s.standing));
  return s;
}
