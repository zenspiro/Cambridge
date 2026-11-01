import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { findSession, recentAudit, signIn, signOut } from "../../src/lib/auth/session.ts";
import { AUTH } from "../../src/lib/config.ts";
import { secretEquals } from "../../src/lib/auth/crypto.ts";

const PASS = "correct horse battery staple";
const T0 = 1_800_000_000_000;
const login = (db: ReturnType<typeof testDb>, password: unknown, now = T0, clientKey = "1.2.3.4") =>
  signIn(db, { password, adminPass: PASS, clientKey }, now);

test("secretEquals compares exactly", async () => {
  assert.equal(await secretEquals("abc", "abc"), true);
  assert.equal(await secretEquals("abc", "abd"), false);
  assert.equal(await secretEquals("abc", "abcd"), false);
  assert.equal(await secretEquals("", ""), true);
});

test("right password signs in; only the token hash is stored", async () => {
  const db = testDb();
  const r = await login(db, PASS);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.expiresAt, T0 + AUTH.sessionHours * 3_600_000);
  assert.deepEqual(await findSession(db, r.token, T0 + 1), { actorId: AUTH.platformAdminId });
  const dump = JSON.stringify(db.raw.prepare("SELECT * FROM admin_session").all());
  assert.ok(!dump.includes(r.token), "raw token must not be stored");
});

test("wrong, empty, oversized and non-text passwords are refused", async () => {
  const db = testDb();
  for (const p of ["nope", "", "x".repeat(AUTH.maxPasswordLength + 1), null, 42]) {
    const r = await login(db, p, T0, `k-${String(p).slice(0, 5)}`);
    assert.deepEqual(r, { ok: false, reason: "bad" });
  }
  assert.equal(await secretEquals(PASS + "x".repeat(200), PASS), false);
});

test("missing or short ADMIN_PASS disables sign-in", async () => {
  const db = testDb();
  for (const adminPass of [undefined, "", "short"]) {
    const r = await signIn(db, { password: "short", adminPass, clientKey: "k" }, T0);
    assert.deepEqual(r, { ok: false, reason: "unavailable" });
  }
});

test("lockout after the limit, even with the right password, until the window ends", async () => {
  const db = testDb();
  for (let i = 0; i < AUTH.maxAttempts; i++) assert.equal((await login(db, "wrong", T0 + i)).ok, false);
  assert.deepEqual(await login(db, PASS, T0 + 10), { ok: false, reason: "locked" });
  assert.deepEqual(await login(db, PASS, T0 + 20), { ok: false, reason: "locked" });
  // Another network is not affected.
  assert.equal((await login(db, PASS, T0 + 30, "5.6.7.8")).ok, true);
  // After the window, the first network can try again.
  const later = T0 + AUTH.windowMinutes * 60_000 + 1;
  assert.equal((await login(db, PASS, later)).ok, true);
});

test("a burst of parallel tries cannot get past the limit", async () => {
  const db = testDb();
  const results = await Promise.all(Array.from({ length: 30 }, () => login(db, "wrong")));
  const checked = results.filter((r) => !r.ok && r.reason === "bad").length;
  assert.equal(checked, AUTH.maxAttempts);
});

test("a right password clears the counter", async () => {
  const db = testDb();
  for (let i = 0; i < AUTH.maxAttempts - 1; i++) await login(db, "wrong");
  assert.ok((await login(db, PASS)).ok);
  for (let i = 0; i < AUTH.maxAttempts; i++) assert.deepEqual(await login(db, "wrong"), { ok: false, reason: "bad" });
});

test("sessions expire, junk tokens are refused, sign-out ends the session", async () => {
  const db = testDb();
  const r = await login(db, PASS);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(await findSession(db, r.token, r.expiresAt), null, "expired at expiresAt");
  for (const bad of [undefined, "", "x".repeat(101), "a b", "<script>", "' OR 1=1 --"]) {
    assert.equal(await findSession(db, bad, T0), null);
  }
  await signOut(db, r.token, T0 + 5);
  assert.equal(await findSession(db, r.token, T0 + 6), null);
});

test("audit log records sign-in events and never the password", async () => {
  const db = testDb();
  await login(db, "my-wrong-guess");
  const r = await login(db, PASS);
  if (r.ok) await signOut(db, r.token, T0 + 1);
  for (let i = 0; i < AUTH.maxAttempts + 3; i++) await login(db, "x", T0 + 2, "attacker");
  const actions = (await recentAudit(db, 100)).map((e) => e.action);
  assert.ok(actions.includes("admin.login"));
  assert.ok(actions.includes("admin.logout"));
  assert.ok(actions.includes("admin.login_failed"));
  assert.equal(actions.filter((a) => a === "admin.login_locked").length, 1, "one lock entry, not one per try");
  const dump = JSON.stringify(db.raw.prepare("SELECT * FROM audit_log").all());
  assert.ok(!dump.includes(PASS) && !dump.includes("my-wrong-guess") && !dump.includes("attacker"));
});
