import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { ICON_NAMES, ICON_SLOTS, iconWords, isIconName, readIcons, resolveIcons, saveIcon } from "../../src/lib/icons.ts";
import { ICONS } from "../../src/components/icons/set.ts";

test("the icon set: the names the picker offers are the icons bundled, and every default is one of them", () => {
  assert.deepEqual([...ICON_NAMES].sort(), Object.keys(ICONS).sort());
  assert.ok(ICON_NAMES.length >= 200, `a chosen set of about 200 (${ICON_NAMES.length})`);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length, "no repeats");
  for (const s of ICON_SLOTS) assert.ok(isIconName(s.default), `${s.id} default ${s.default}`);
  assert.equal(new Set(ICON_SLOTS.map((s) => s.id)).size, ICON_SLOTS.length);
  assert.ok(isIconName("circle-help"), "the fallback icon is in the set");
  assert.equal(iconWords("chart-column"), "Chart column");
});

test("icons: a choice is kept per place, unknown places and icons are refused, Default puts it back", async () => {
  const db = testDb();
  assert.equal((await readIcons(db))["admin.library"], "library");
  assert.equal(await saveIcon(db, "admin.library", "book-open", "a"), true);
  assert.equal(await saveIcon(db, "student.me", "smile", "a"), true);
  const icons = await readIcons(db);
  assert.deepEqual([icons["admin.library"], icons["student.me"], icons["admin.home"]], ["book-open", "smile", "house"]);
  assert.equal(await saveIcon(db, "admin.nope", "book", "a"), false);
  assert.equal(await saveIcon(db, "admin.home", "<script>", "a"), false);
  assert.equal(await saveIcon(db, "admin.library", null, "a"), true);
  assert.equal((await readIcons(db))["admin.library"], "library");
  assert.equal((await readIcons(db))["student.me"], "smile", "other choices stay");
  const audit = await db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'icons.%' ORDER BY at`).bind().all<{ action: string }>();
  assert.deepEqual(audit.results.map((r) => r.action), ["icons.choose", "icons.choose", "icons.reset"]);
  // Stored values that are not known icons fall back to the default.
  assert.equal(resolveIcons({ "admin.home": "not-an-icon", constructor: "x" })["admin.home"], "house");
  assert.equal(resolveIcons(null)["parent.family"], "users");
});
