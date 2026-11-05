// Profiles, parent approval, exam plans, export and delete (Phase 1 step 3) on a SQLite copy of the schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageLimit, birthYearOk, checkConsentSettings, checkDetails, checkExamPlan, createConsent, decideConsent, deleteAccount,
  exportAccount, getConsentSettings, getProfile, latestConsent, listExamPlans, mayBeUnder, openConsent, removeExamPlan,
  saveConsentSettings, saveDetails, saveExamPlan, saveTheme, standing,
} from "../../src/lib/account/profile.ts";
import { consentEmail } from "../../src/lib/account/email.ts";
import { countryName, countryOptions, isCountry } from "../../src/lib/countries.ts";
import { CONSENT } from "../../src/lib/config.ts";
import { testDb } from "./helpers/d1.ts";

const YEAR = 2026;
const NOW = Date.UTC(2026, 10, 5);

function withUser(email = "zara@example.com") {
  const db = testDb();
  const id = `u-${Math.random().toString(36).slice(2, 10)}`;
  db.raw.prepare(`INSERT INTO "auth_user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "firstName", "lastName") VALUES (?, 'Zara Khan', ?, 1, ?, ?, 'Zara', 'Khan')`).run(id, email, NOW, NOW);
  db.raw.prepare(`INSERT INTO user_role (user_id, role, created_at) VALUES (?, 'student', ?)`).run(id, NOW);
  return { db, id };
}

test("countries: real codes only, launch markets first, names from Intl", () => {
  assert.ok(isCountry("PK") && isCountry("GB") && !isCountry("XX") && !isCountry("pk"));
  assert.deepEqual(countryOptions().slice(0, 5).map((c) => c.code), ["PK", "AE", "SA", "GB", "US"]);
  assert.equal(countryName("AE"), "United Arab Emirates");
  assert.ok(countryOptions().length > 240);
});

test("age limits: default, per-country overrides, the safe side with only a birth year", () => {
  assert.deepEqual(checkConsentSettings({ defaultAge: 18, byCountry: { SA: 21 } }), { defaultAge: 18, byCountry: { SA: 21 } });
  assert.equal(checkConsentSettings({ defaultAge: 5, byCountry: {} }), null);
  assert.equal(checkConsentSettings({ defaultAge: 18, byCountry: { XX: 18 } }), null);
  const s = { defaultAge: 18, byCountry: { SA: 21 } };
  assert.equal(ageLimit(s, "PK"), 18);
  assert.equal(ageLimit(s, "SA"), 21);
  assert.equal(mayBeUnder(2008, 18, YEAR), true, "born 2008 may still be 17 in 2026");
  assert.equal(mayBeUnder(2007, 18, YEAR), false);
  assert.ok(birthYearOk(2010, YEAR) && !birthYearOk(YEAR - CONSENT.youngestAge + 1, YEAR) && !birthYearOk(1900, YEAR));
  assert.deepEqual(checkDetails({ country: "PK", birthYear: "2010" }, true, YEAR), { country: "PK", birthYear: 2010 });
  assert.equal(checkDetails({ country: "PK", birthYear: "" }, true, YEAR), null, "students need a birth year");
  assert.deepEqual(checkDetails({ country: "AE", birthYear: null }, false, YEAR), { country: "AE", birthYear: null });
});

test("standing: details first, then a parent for minors, adults straight in; overrides apply", async () => {
  const { db, id } = withUser();
  assert.equal(await standing(db, id, ["student"], YEAR), "details");
  assert.equal(await standing(db, id, ["parent"], YEAR), "ok");
  await saveDetails(db, id, { country: "PK", birthYear: 2010 }, NOW);
  assert.equal(await standing(db, id, ["student"], YEAR), "pending");
  await saveDetails(db, id, { country: "PK", birthYear: 2006 }, NOW);
  assert.equal(await standing(db, id, ["student"], YEAR), "ok");
  await saveConsentSettings(db, { defaultAge: 18, byCountry: { PK: 21 } }, "platform-admin", NOW);
  assert.deepEqual((await getConsentSettings(db)).byCountry, { PK: 21 });
  assert.equal(await standing(db, id, ["student"], YEAR), "pending", "a higher limit for the country applies");
});

test("parent approval: hashed single-use links, replaced by a new one, approve lets the student in", async () => {
  const { db, id } = withUser();
  await saveDetails(db, id, { country: "PK", birthYear: 2011 }, NOW);
  const first = await createConsent(db, id, "mum@example.com", NOW);
  const second = await createConsent(db, id, "dad@example.com", NOW + 1000);
  const rows = db.raw.prepare("SELECT token_hash, status FROM parent_consent ORDER BY created_at").all() as { token_hash: string; status: string }[];
  assert.deepEqual(rows.map((r) => r.status), ["replaced", "pending"]);
  assert.ok(rows.every((r) => !r.token_hash.includes(first) && !r.token_hash.includes(second)), "tokens are stored hashed");
  assert.deepEqual(await openConsent(db, first, NOW), { ok: false, reason: "used" });
  assert.deepEqual(await openConsent(db, "x".repeat(43), NOW), { ok: false, reason: "unknown" });
  assert.deepEqual(await openConsent(db, second, NOW + CONSENT.linkDays * 86_400_000 + 5000), { ok: false, reason: "expired" });
  const open = await openConsent(db, second, NOW);
  assert.ok(open.ok && open.firstName === "Zara" && open.parentEmail === "dad@example.com");
  assert.equal((await latestConsent(db, id))?.parentEmail, "dad@example.com");
  const r = await decideConsent(db, second, "approved", NOW + 2000);
  assert.ok(r.ok);
  assert.equal(await standing(db, id, ["student"], YEAR), "ok");
  assert.deepEqual(await decideConsent(db, second, "declined", NOW + 3000), { ok: false, reason: "used" }, "a link answers once");
  await saveDetails(db, id, { country: "GB", birthYear: 2000 }, NOW);
  const p = await getProfile(db, id);
  assert.deepEqual([p.country, p.birthYear], ["GB", 2011], "the birth year is locked after approval");
});

test("a declined request deletes the student's account and everything it owns", async () => {
  const { db, id } = withUser();
  await saveDetails(db, id, { country: "PK", birthYear: 2012 }, NOW);
  await saveExamPlan(db, id, { code: "0625", session: "s", year: 2027 }, NOW);
  const token = await createConsent(db, id, "mum@example.com", NOW);
  assert.ok((await decideConsent(db, token, "declined", NOW)).ok);
  for (const t of ["\"auth_user\"", "profile", "exam_plan", "parent_consent", "user_role"]) {
    assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n, 0, `${t} is empty`);
  }
  const notes = db.raw.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid").all(id) as { action: string }[];
  assert.deepEqual(notes.map((n) => n.action), ["consent.sent", "consent.declined", "account.deleted"], "the audit log keeps a note");
});

test("exam plans: library subjects, sessions and years ahead only; one per subject", async () => {
  const { db, id } = withUser();
  const codes = ["0625", "0620"];
  assert.deepEqual(checkExamPlan({ code: "0625", session: "s", year: "2027" }, codes, YEAR), { code: "0625", session: "s", year: 2027 });
  assert.equal(checkExamPlan({ code: "9999", session: "s", year: "2027" }, codes, YEAR), null);
  assert.equal(checkExamPlan({ code: "0625", session: "y", year: "2027" }, codes, YEAR), null);
  assert.equal(checkExamPlan({ code: "0625", session: "s", year: "2040" }, codes, YEAR), null);
  await saveExamPlan(db, id, { code: "0625", session: "s", year: 2027 }, NOW);
  await saveExamPlan(db, id, { code: "0625", session: "w", year: 2027 }, NOW);
  await saveExamPlan(db, id, { code: "0620", session: "s", year: 2027 }, NOW);
  assert.deepEqual(await listExamPlans(db, id), [{ code: "0620", session: "s", year: 2027 }, { code: "0625", session: "w", year: 2027 }]);
  await removeExamPlan(db, id, "0620");
  assert.equal((await listExamPlans(db, id)).length, 1);
});

test("export has the person's data and no secrets; delete removes it and unused codes", async () => {
  const { db, id } = withUser("del@example.com");
  await saveDetails(db, id, { country: "AE", birthYear: 2000 }, NOW);
  await saveTheme(db, id, "b", NOW);
  await createConsent(db, id, "mum@example.com", NOW);
  const data = await exportAccount(db, id);
  const text = JSON.stringify(data);
  assert.ok(text.includes("del@example.com") && text.includes("mum@example.com") && text.includes('"theme":"b"'));
  assert.ok(!text.includes("token_hash") && !text.includes("token"), "no tokens in the export");
  db.raw.prepare(`INSERT INTO "auth_verification" (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ('v1', 'sign-in-otp-del@example.com', 'x', ?, ?, ?)`).run(NOW, NOW, NOW);
  await deleteAccount(db, id, id, NOW);
  assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM "auth_verification"`).get() as { n: number }).n, 0);
  assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM profile`).get() as { n: number }).n, 0);
});

test("the approval email names the child, links the page and says what decline does", () => {
  const m = consentEmail("Prep", "mum@example.com", "Zara <Khan>", "https://x.example/consent/abc", 7);
  assert.match(m.subject, /Please approve Zara <Khan>'s Prep account/);
  assert.match(m.text, /https:\/\/x\.example\/consent\/abc/);
  assert.match(m.text, /7 days/);
  assert.match(m.text, /deleted/);
  assert.ok(m.html.includes("Zara &#60;Khan&#62;"));
});
