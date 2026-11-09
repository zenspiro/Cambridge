import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { acceptInvite, accessFromForm, accessWords, can, cancelInvite, cleanAccess, createInvite, hasSubject, listInvites, listMembers, openInvite, readMember, updateMember, type Access } from "../../src/lib/auth/team.ts";
import { listAccounts } from "../../src/lib/account/list.ts";
import { safeNext } from "../../src/lib/account/roles.ts";

const user = (db: ReturnType<typeof testDb>, id: string, email: string) =>
  db.prepare(`INSERT INTO "auth_user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "firstName", "lastName") VALUES (?1, ?2, ?3, 1, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z', ?2, 'Tester')`).bind(id, id, email).run();
const ACCESS: Access = { library: "view", sourceReview: "edit", aiReview: "none", subjects: ["0625"] };

test("access: levels per area, subjects, made safe", () => {
  assert.ok(can(ACCESS, "library", "view", "0625"));
  assert.ok(!can(ACCESS, "library", "edit", "0625"), "view is not edit");
  assert.ok(can(ACCESS, "sourceReview", "view", "0625"), "edit includes view");
  assert.ok(!can(ACCESS, "sourceReview", "edit", "0620"), "another subject");
  assert.ok(!can(ACCESS, "aiReview", "view"));
  assert.ok(can({ ...ACCESS, subjects: "all" }, "library", "view", "0478"));
  assert.ok(!can({ ...ACCESS, subjects: [] }, "library", "view"), "no subjects, no access");
  assert.ok(hasSubject(ACCESS, "0625") && !hasSubject(ACCESS, "0620"));
  assert.deepEqual(cleanAccess({ library: "admin", sourceReview: "view", subjects: ["0625", "0625", "x", "9999"] }, new Set(["0625"])), { library: "none", sourceReview: "view", aiReview: "none", subjects: ["0625"] });
  assert.deepEqual(cleanAccess(null), { library: "none", sourceReview: "none", aiReview: "none", subjects: [] });
  const form = new FormData();
  form.set("library", "edit");
  form.set("sourceReview", "view");
  form.append("subject", "0620");
  form.append("subject", "0625");
  assert.deepEqual(accessFromForm(form, new Set(["0620", "0625"])), { library: "edit", sourceReview: "view", aiReview: "none", subjects: ["0620", "0625"] });
  form.set("allSubjects", "1");
  assert.equal(accessFromForm(form, new Set()).subjects, "all");
  assert.equal(accessWords(ACCESS), "Library: view only; Source review: view and edit; 0625");
});

test("invites: one link per email, accepted once by that email only, then a member; cancel, pause, remove", async () => {
  const db = testDb();
  const now = 1_800_000_000_000;
  assert.deepEqual(await createInvite(db, "not an email", "A", ACCESS, "platform-admin", now), { ok: false, reason: "bad_email" });
  assert.deepEqual(await createInvite(db, "a@example.com", "", ACCESS, "platform-admin", now), { ok: false, reason: "no_name" });
  assert.deepEqual(await createInvite(db, "a@example.com", "Ayesha", { ...ACCESS, library: "none", sourceReview: "none" }, "platform-admin", now), { ok: false, reason: "no_access" });
  const first = await createInvite(db, "A@Example.com ", "Ayesha", ACCESS, "platform-admin", now);
  const second = await createInvite(db, "a@example.com", "Ayesha", ACCESS, "platform-admin", now + 1);
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(await openInvite(db, first.token, now), { ok: false, reason: "unknown" }, "the older link is replaced");
  const open = await openInvite(db, second.token, now);
  assert.ok(open.ok && open.email === "a@example.com" && open.name === "Ayesha");
  assert.equal((await listInvites(db)).length, 1);

  await user(db, "u-ayesha", "a@example.com");
  await user(db, "u-other", "b@example.com");
  assert.equal(await acceptInvite(db, second.token, { id: "u-other", email: "b@example.com" }, now), "wrong_email");
  assert.equal(await acceptInvite(db, second.token, { id: "u-ayesha", email: "A@example.com" }, now), "ok");
  assert.equal(await acceptInvite(db, second.token, { id: "u-ayesha", email: "a@example.com" }, now), "used", "once");
  const m = await readMember(db, "u-ayesha");
  assert.deepEqual([m?.status, m?.access.subjects, m?.name], ["active", ["0625"], "u-ayesha Tester"]);
  assert.deepEqual(await createInvite(db, "a@example.com", "Ayesha", ACCESS, "platform-admin", now), { ok: false, reason: "member" });

  const late = await createInvite(db, "c@example.com", "Chen", ACCESS, "platform-admin", now);
  assert.ok(late.ok);
  if (late.ok) {
    assert.deepEqual(await openInvite(db, late.token, now + 8 * 86_400_000), { ok: false, reason: "expired" });
    assert.equal(await cancelInvite(db, late.id, "platform-admin", now), true);
    assert.deepEqual(await openInvite(db, late.token, now), { ok: false, reason: "unknown" });
  }

  assert.equal(await updateMember(db, "u-ayesha", { access: { ...ACCESS, library: "edit" } }, "platform-admin", now), true);
  assert.equal((await readMember(db, "u-ayesha"))?.access.library, "edit");
  await updateMember(db, "u-ayesha", { status: "paused" }, "platform-admin", now);
  assert.equal((await readMember(db, "u-ayesha"))?.status, "paused");
  assert.equal((await listAccounts(db, { role: "team" })).total, 1, "team members are marked in the account list");
  await updateMember(db, "u-ayesha", { remove: true }, "platform-admin", now);
  assert.equal(await readMember(db, "u-ayesha"), null);
  assert.equal((await listMembers(db)).length, 0);
  const actions = (await db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'team.%' ORDER BY rowid`).bind().all<{ action: string }>()).results.map((r) => r.action);
  assert.deepEqual(actions, ["team.invite", "team.invite", "team.join", "team.invite", "team.invite_cancel", "team.access", "team.pause", "team.remove"]);
});

test("a sign-in may go back only to the admin or a team invite", () => {
  assert.equal(safeNext("/admin"), "/admin");
  assert.equal(safeNext("/team/join/abcdefghijklmnopqrstuvwxyz"), "/team/join/abcdefghijklmnopqrstuvwxyz");
  for (const bad of ["https://evil.example/admin", "//evil.example", "/admin/ai", "/student", "/team/join/short", null]) assert.equal(safeNext(bad), null, String(bad));
});

test("the account list: newest first, search and role filters", async () => {
  const db = testDb();
  await user(db, "u1", "zara@example.com");
  await user(db, "u2", "omar@example.com");
  await db.prepare(`INSERT INTO user_role (user_id, role, created_at) VALUES ('u1', 'student', 1), ('u2', 'parent', 1)`).bind().run();
  await db.prepare(`INSERT INTO profile (user_id, country, birth_year, updated_at) VALUES ('u1', 'PK', 2011, 1)`).bind().run();
  const all = await listAccounts(db);
  assert.equal(all.total, 2);
  assert.deepEqual((await listAccounts(db, { q: "zara" })).rows.map((r) => [r.email, r.roles.join(), r.country, r.birthYear]), [["zara@example.com", "student", "PK", 2011]]);
  assert.deepEqual((await listAccounts(db, { role: "parent" })).rows.map((r) => r.email), ["omar@example.com"]);
});
