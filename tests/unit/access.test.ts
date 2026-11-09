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
const TEAM_ROUTES = [
  "admin/page.tsx",
  "admin/brain/runs/[id]/route.ts",
  "admin/library/page.tsx",
  "admin/library/[code]/page.tsx",
  "admin/library/[code]/[year]/[session]/page.tsx",
  "admin/library/[code]/version/[from]/page.tsx",
  "admin/library/[code]/map/route.ts",
  "admin/library/add/page.tsx",
  "admin/library/add/link/route.ts",
  "admin/library/add/upload/route.ts",
  "admin/library/upload/page.tsx",
  "admin/library/upload/send/route.ts",
  "admin/library/folder/page.tsx",
  "admin/library/folder/file/route.ts",
  "admin/library/folder/ai/route.ts",
  "admin/library/file/[id]/route.ts",
  "admin/library/file/[id]/view/route.ts",
  "admin/library/review/[id]/page.tsx",
  "admin/library/review/[id]/fix/route.ts",
  "admin/library/review/[id]/figure/[fig]/route.ts",
  "admin/library/review/[id]/figure/[fig]/page/route.ts",
].sort();

test("only the listed admin pages let team members in; the rest stay the owner's", () => {
  const admin = routes(appDir).filter((r) => r.startsWith("admin/"));
  const team = admin.filter((r) => /\b(requireStaff\(|staffFor\(|staffForDoc\(|staffPost\(|addFilePost\()/.test(readFileSync(join(appDir, r), "utf8").replace(/\/\/.*$/gm, ""))).sort();
  assert.deepEqual(team, TEAM_ROUTES);
  for (const r of ["admin/users/team/page.tsx", "admin/users/team/invite/route.ts", "admin/users/team/member/route.ts", "admin/ai/page.tsx", "admin/library/review/[id]/read/route.ts", "admin/library/[code]/read-all/route.ts", "admin/agent/start/route.ts"]) {
    assert.ok(admin.includes(r) && !team.includes(r), `${r} is the owner's only`);
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
  for (const r of routes(appDir).filter((x) => x.startsWith("api/") && !signed(x))) {
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
