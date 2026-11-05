// Better Auth set up for student and parent accounts (owner approved, 5 Nov 2026): email codes and Google.
// Built per request, because the database and secrets come from the Worker. The database is passed in, so unit
// tests run the real thing on Node's SQLite. Better Auth's own sign-up and password routes are not exposed: our
// route handlers call auth.api.* (src/app/account/*), and /api/auth only serves the Google callback.
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import { ACCOUNT } from "../config.ts";

export type AuthAudit = (action: "account.created" | "account.signin", userId: string) => Promise<void>;

export type AuthSetup = {
  /** A D1 binding in the Worker, a node:sqlite DatabaseSync in tests. */
  database: Parameters<typeof betterAuth>[0]["database"];
  secret: string;
  baseURL: string;
  appName: string;
  google?: { clientId: string; clientSecret: string };
  sendCode: (email: string, code: string) => Promise<void>;
  audit: AuthAudit;
};

export function makeAuth(s: AuthSetup) {
  return betterAuth({
    appName: s.appName,
    baseURL: s.baseURL,
    secret: s.secret,
    database: s.database,
    trustedOrigins: [s.baseURL],
    telemetry: { enabled: false },
    user: {
      modelName: "auth_user",
      additionalFields: {
        firstName: { type: "string", required: false, input: false },
        lastName: { type: "string", required: false, input: false },
      },
    },
    session: { modelName: "auth_session", expiresIn: ACCOUNT.sessionDays * 86_400, updateAge: ACCOUNT.renewHours * 3_600 },
    account: { modelName: "auth_account", accountLinking: { enabled: true, trustedProviders: ["google"] } },
    verification: { modelName: "auth_verification" },
    emailAndPassword: { enabled: false },
    socialProviders: s.google ? { google: { clientId: s.google.clientId, clientSecret: s.google.clientSecret, prompt: "select_account" } } : {},
    plugins: [
      emailOTP({
        otpLength: ACCOUNT.codeLength,
        expiresIn: ACCOUNT.codeMinutes * 60,
        allowedAttempts: ACCOUNT.codeTries,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in") await s.sendCode(email, otp);
        },
      }),
    ],
    // Our own limits (src/lib/ratelimit.ts, in the database) guard the routes; Better Auth's keeps counts in memory.
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: ACCOUNT.cookiePrefix,
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      user: { create: { after: async (u) => { await s.audit("account.created", u.id); } } },
      session: { create: { after: async (x) => { await s.audit("account.signin", x.userId); } } },
    },
  });
}

export type Auth = ReturnType<typeof makeAuth>;
