// Route access list (brief 4, 15.2). Every page and route handler under src/app
// must either call requireAdmin() or be listed here. A unit test enforces it.

/** App directory paths (relative to src/app) that are open to everyone. */
export const PUBLIC_ROUTES: readonly string[] = [
  "page.tsx", // placeholder home page
  "health/route.ts", // pass or fail only
  "brand/[file]/route.ts", // current logo, square logo and favicon only (public by nature)
  "admin/login/page.tsx", // the sign-in form
  // Student and parent sign-in (before a session exists): same origin, rate limited per email and network.
  "signin/page.tsx",
  "account/code/route.ts",
  "account/verify/route.ts",
  "account/google/route.ts",
  // Parent approval: the emailed link's token is the key (stored hashed, single use, expires); answers need a button.
  "consent/[token]/page.tsx",
  "consent/[token]/answer/route.ts",
  "consent/done/page.tsx",
  // Better Auth: only the Google callback is answered (checked in tests/unit/access.test.ts).
  "api/auth/[...all]/route.ts",
  "admin/session/route.ts", // sign-in POST: rate limited and audited
  // Agent endpoints: no session, but every request must pass agentRequest()
  // (HMAC signature, 5 minute clock window, single-use nonce). Tested.
  "api/agent/job/route.ts",
  "api/agent/file/route.ts",
  "api/agent/finish/route.ts",
  "api/agent/progress/route.ts",
  "api/agent/catalog/route.ts",
  "api/agent/ai/route.ts",
  "api/agent/doc/route.ts",
  // Subject brain endpoints (topic tree runs): the same signed door.
  "api/brain/job/route.ts",
  "api/brain/doc/route.ts",
  "api/brain/step/route.ts",
  "api/brain/fail/route.ts",
  "api/brain/finish/route.ts",
];
