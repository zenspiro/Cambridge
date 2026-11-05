// Families (Phase 1 step 4) on a SQLite copy of the schema: codes, joining, linking by approval, approving from
// home, parent-made child accounts, removing, leaving, limits and cascades.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanFamilyCode, createChild, isMyChild, joinByCode, leaveFamily, linkApproved, listChildren, liveCode, makeCode,
  myFamily, removeChild, showCode, waitingForParent,
} from "../../src/lib/account/family.ts";
import { createConsent, decideConsent, decideConsentAsParent, deleteAccount, saveDetails, standing } from "../../src/lib/account/profile.ts";
import { FAMILY } from "../../src/lib/config.ts";
import { testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 5);
const YEAR = 2026;

function person(db: ReturnType<typeof testDb>, role: "student" | "parent", email: string, first = "A") {
  const id = `u-${Math.random().toString(36).slice(2, 10)}`;
  db.raw.prepare(`INSERT INTO "auth_user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "firstName", "lastName") VALUES (?, ?, ?, 1, ?, ?, ?, 'Khan')`).run(id, `${first} Khan`, email, NOW, NOW, first);
  db.raw.prepare(`INSERT INTO user_role (user_id, role, created_at) VALUES (?, ?, ?)`).run(id, role, NOW);
  return id;
}

test("family codes: readable, typed loosely, replaced by a new one, expire", async () => {
  const db = testDb();
  const mum = person(db, "parent", "mum@example.com", "Sara");
  const c1 = await makeCode(db, mum, NOW);
  assert.match(c1.code, new RegExp(`^[A-HJKMNP-Z2-9]{${FAMILY.codeLength}}$`));
  assert.equal(cleanFamilyCode(` ${showCode(c1.code).toLowerCase()} `), c1.code);
  assert.equal(cleanFamilyCode("ABC"), null);
  const c2 = await makeCode(db, mum, NOW + 1);
  assert.equal((await liveCode(db, mum, NOW + 2))?.code, c2.code);
  const kid = person(db, "student", "kid@example.com", "Zara");
  assert.equal(await joinByCode(db, kid, c1.code, NOW + 3), "bad_code", "the old code stops working");
  assert.equal(await joinByCode(db, kid, c2.code, c2.expiresAt + 1), "bad_code", "an expired code does not work");
  assert.equal(await liveCode(db, mum, c2.expiresAt + 1), null);
});

test("joining by code: students only, one family per child, a family has a limit", async () => {
  const db = testDb();
  const mum = person(db, "parent", "mum@example.com", "Sara");
  const other = person(db, "parent", "other@example.com", "Ali");
  const { code } = await makeCode(db, mum, NOW);
  const kid = person(db, "student", "kid@example.com", "Zara");
  assert.equal(await joinByCode(db, other, code, NOW), "not_student");
  assert.equal(await joinByCode(db, kid, code, NOW), "ok_joined");
  assert.equal(await joinByCode(db, kid, code, NOW), "in_family");
  const { code: code2 } = await makeCode(db, other, NOW);
  assert.equal(await joinByCode(db, kid, code2, NOW), "in_family", "a child is in one family only");
  assert.ok(await isMyChild(db, mum, kid));
  assert.ok(!(await isMyChild(db, other, kid)));
  for (let i = 1; i < FAMILY.maxChildren; i++) assert.equal(await joinByCode(db, person(db, "student", `k${i}@example.com`), code, NOW), "ok_joined");
  assert.equal(await joinByCode(db, person(db, "student", "extra@example.com"), code, NOW), "full");
});

test("a child approved by email joins that parent's family by itself; approving from home works too", async () => {
  const db = testDb();
  const kid = person(db, "student", "kid@example.com", "Zara");
  await saveDetails(db, kid, { country: "PK", birthYear: 2012 }, NOW);
  const token = await createConsent(db, kid, "mum@example.com", NOW);
  assert.ok((await decideConsent(db, token, "approved", NOW)).ok);
  const mum = person(db, "parent", "mum@example.com", "Sara");
  assert.equal(await linkApproved(db, mum, "Mum@Example.com", NOW), 1);
  assert.equal(await linkApproved(db, mum, "mum@example.com", NOW), 0, "only once");
  assert.equal((await listChildren(db, mum))[0]?.how, "approved");

  const kid2 = person(db, "student", "kid2@example.com", "Omar");
  await saveDetails(db, kid2, { country: "PK", birthYear: 2013 }, NOW);
  await createConsent(db, kid2, "mum@example.com", NOW);
  const waiting = await waitingForParent(db, "mum@example.com", NOW);
  assert.deepEqual(waiting.map((w) => w.firstName), ["Omar"]);
  assert.deepEqual(await decideConsentAsParent(db, waiting[0]!.id, "someone@example.com", mum, "approved", NOW), { ok: false }, "only the addressed parent");
  assert.ok((await decideConsentAsParent(db, waiting[0]!.id, "mum@example.com", mum, "approved", NOW)).ok);
  assert.equal(await standing(db, kid2, ["student"], YEAR), "ok");
  assert.equal(await linkApproved(db, mum, "mum@example.com", NOW), 1);
  assert.equal((await waitingForParent(db, "mum@example.com", NOW)).length, 0);
  assert.equal(await removeChild(db, mum, kid2, NOW), true);
  assert.equal(await linkApproved(db, mum, "mum@example.com", NOW), 0, "a removed child is not added back");
});

test("a parent-made child account: own email, counted as approved, never over an existing account", async () => {
  const db = testDb();
  const mum = person(db, "parent", "mum@example.com", "Sara");
  person(db, "student", "taken@example.com");
  const child = { firstName: "Zara", lastName: "Khan", email: "zara@example.com", birthYear: 2013, country: "PK" };
  assert.equal(await createChild(db, mum, { ...child, email: "taken@example.com" }, NOW), "has_account");
  assert.equal(await createChild(db, mum, child, NOW), "ok_created");
  const [c] = await listChildren(db, mum);
  assert.equal(c?.email, "zara@example.com");
  assert.equal(c?.how, "created");
  assert.equal(c?.standing, "ok", "the parent made it, so it is approved");
  const u = db.raw.prepare(`SELECT "emailVerified" AS v, "createdAt" AS at FROM "auth_user" WHERE email = 'zara@example.com'`).get() as { v: number; at: string };
  assert.equal(u.v, 0);
  assert.match(u.at, /^\d{4}-\d{2}-\d{2}T/, "dates in Better Auth's own format");
});

test("remove, leave (adults only), and what deleting does to a family", async () => {
  const db = testDb();
  const mum = person(db, "parent", "mum@example.com", "Sara");
  const { code } = await makeCode(db, mum, NOW);
  const young = person(db, "student", "young@example.com", "Zara");
  await saveDetails(db, young, { country: "PK", birthYear: 2012 }, NOW);
  const adult = person(db, "student", "adult@example.com", "Omar");
  await saveDetails(db, adult, { country: "PK", birthYear: 2000 }, NOW);
  await joinByCode(db, young, code, NOW);
  await joinByCode(db, adult, code, NOW);
  assert.deepEqual(await myFamily(db, young, YEAR), { parentFirstName: "Sara", parentLastName: "Khan", canLeave: false });
  assert.equal(await leaveFamily(db, young, NOW), "too_young");
  assert.equal(await leaveFamily(db, adult, NOW), "ok_left");
  assert.equal(await removeChild(db, "someone-else", young, NOW), false, "only their own parent");
  assert.equal(await removeChild(db, mum, young, NOW), true);
  assert.equal(await myFamily(db, young, YEAR), null);
  await joinByCode(db, young, code, NOW);
  await deleteAccount(db, young, mum, NOW);
  assert.equal((await listChildren(db, mum)).length, 0, "a deleted child leaves the family");
  await joinByCode(db, adult, code, NOW);
  await deleteAccount(db, mum, mum, NOW);
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM family").get() as { n: number }).n, 0, "the family goes with the parent");
  assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM "auth_user" WHERE id = ?`).get(adult) as { n: number }).n, 1, "the child's account stays");
});
