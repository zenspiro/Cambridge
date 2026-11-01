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

test("every page and route is public on purpose or checks the admin session", () => {
  const found = routes(appDir);
  assert.ok(found.length >= 5);
  for (const r of found) {
    if (PUBLIC_ROUTES.includes(r)) continue;
    const src = readFileSync(join(appDir, r), "utf8");
    assert.match(src, /\b(requireAdmin|adminSession)\(\)/, `${r} has no auth check and is not in PUBLIC_ROUTES`);
  }
});

test("the public list has no stale entries and nothing under admin except sign-in", () => {
  const found = routes(appDir);
  for (const p of PUBLIC_ROUTES) assert.ok(found.includes(p), `${p} does not exist`);
  const adminPublic = PUBLIC_ROUTES.filter((p) => p.startsWith("admin/"));
  assert.deepEqual(adminPublic.sort(), ["admin/login/page.tsx", "admin/session/route.ts"]);
});
