import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PUBLIC_ROUTES } from "../../src/lib/access.ts";

const appDir = new URL("../../src/app/", import.meta.url).pathname;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return /^(page\.tsx|route\.ts)$/.test(n) ? [relative(appDir, p)] : [];
  });
}

test("every page and route is public on purpose or checks the admin or account session", () => {
  const found = routes(appDir);
  assert.ok(found.length >= 5);
  for (const r of found) {
    if (PUBLIC_ROUTES.includes(r)) continue;
    const src = readFileSync(join(appDir, r), "utf8");
    // Guards: requireAdmin() for pages, adminSession() for handlers, adminPost() wraps adminSession().
    const code = src.replace(/\/\/.*$/gm, "");
    assert.match(code, /\b(requireAdmin\(\)|adminSession\(\)|adminPost\(|addFilePost\(|requireAccount\(\)|requireRole\(|accountSession\(\)|accountPost\(|requireStaff\(|staffFor\(|staffForDoc\(|staffPost\()/, `${r} has no auth check and is not in PUBLIC_ROUTES`);
  }
});

// Team access (owner, 9 Nov 2026): only these admin pages and routes may let a team member in; every other admin page
// stays the owner's (requireAdmin, adminSession, adminPost). A new one here is a decision, not an accident.
// Owner, 9 Nov 2026: a team member may reach every admin page and action their access allows (the whole admin
// included), except these, which stay the owner's whatever the access: the team itself, AI setup's changes, and the
// owner's own sign-in.
const OWNER_ONLY = [
  "admin/ai/cap/route.ts",
  "admin/ai/check/route.ts",
  "admin/ai/model/route.ts",
  "admin/ai/price/route.ts",
  "admin/login/page.tsx",
  "admin/session/end/route.ts",
  "admin/session/route.ts",
  "admin/users/team/invite/cancel/route.ts",
  "admin/users/team/invite/resend/route.ts",
  "admin/users/team/invite/route.ts",
  "admin/users/team/member/route.ts",
  "admin/users/team/page.tsx",
].sort();

test("team members reach only pages that check their access; the team, AI setup's changes and sign-in stay the owner's", () => {
  const admin = routes(appDir).filter((r) => r.startsWith("admin/"));
  const staffGuard = (r: string) => /\b(requireStaff\(|staffFor\(|staffForDoc\(|staffPost\(|addFilePost\()/.test(readFileSync(join(appDir, r), "utf8").replace(/\/\/.*$/gm, ""));
  assert.deepEqual(admin.filter((r) => !staffGuard(r)).sort(), OWNER_ONLY);
  for (const r of OWNER_ONLY.filter((x) => x !== "admin/login/page.tsx" && !x.startsWith("admin/session"))) {
    assert.match(readFileSync(join(appDir, r), "utf8"), /requireAdmin\(|adminPost\(/, `${r} checks the owner's sign-in`);
  }
  // Every page and action for the whole admin names its need; the pages that change things take edit.
  for (const r of admin.filter((x) => staffGuard(x) && x.endsWith("route.ts"))) {
    const code = readFileSync(join(appDir, r), "utf8");
    if (/staffPost\(request, [^,]+, ADMIN_VIEW/.test(code)) assert.fail(`${r}: a change needs edit, not view`);
  }
});

test("agent and brain endpoints are public only behind a signed request", () => {
  const signed = (r: string) => r.startsWith("api/agent/") || r.startsWith("api/brain/");
  const agent = routes(appDir).filter(signed);
  assert.ok(agent.length >= 3);
  for (const r of agent) {
    assert.ok(PUBLIC_ROUTES.includes(r), `${r} should be listed as public (signed)`);
    const code = readFileSync(join(appDir, r), "utf8").replace(/\/\/.*$/gm, "");
    assert.match(code, /\bagentRequest\(request/, `${r} must verify the signature with agentRequest()`);
  }
  // Readings from a dev session (owner, 12 Nov 2026): public only behind the bearer key.
  const keyed = routes(appDir).filter((x) => x.startsWith("api/reader/"));
  for (const r of keyed) {
    assert.ok(PUBLIC_ROUTES.includes(r), `${r} should be listed as public (key)`);
    const code = readFileSync(join(appDir, r), "utf8").replace(/\/\/.*$/gm, "");
    assert.match(code, /\breaderRequest\(request/, `${r} must check the key with readerRequest()`);
  }
  for (const r of routes(appDir).filter((x) => x.startsWith("api/") && !signed(x) && !x.startsWith("api/reader/"))) {
    if (r === "api/auth/[...all]/route.ts") continue;
    assert.fail(`${r}: new api routes need their own rule here`);
  }
});

test("Better Auth's catch-all answers only the Google callback, and only GET", () => {
  const code = readFileSync(join(appDir, "api/auth/[...all]/route.ts"), "utf8");
  assert.match(code, /new Set\(\["\/api\/auth\/callback\/google"\]\)/);
  assert.doesNotMatch(code, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("the public list has no stale entries and nothing under admin except sign-in", () => {
  const found = routes(appDir);
  for (const p of PUBLIC_ROUTES) assert.ok(found.includes(p), `${p} does not exist`);
  const adminPublic = PUBLIC_ROUTES.filter((p) => p.startsWith("admin/"));
  assert.deepEqual(adminPublic.sort(), ["admin/login/page.tsx", "admin/session/route.ts"]);
});
