// Route access list (brief 4, 15.2). Every page and route handler under src/app
// must either call requireAdmin() or be listed here. A unit test enforces it.

/** App directory paths (relative to src/app) that are open to everyone. */
export const PUBLIC_ROUTES: readonly string[] = [
  "page.tsx", // placeholder home page
  "health/route.ts", // pass or fail only
  "admin/login/page.tsx", // the sign-in form
  "admin/session/route.ts", // sign-in POST: rate limited and audited
];
