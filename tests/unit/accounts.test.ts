// Student and parent accounts (Phase 1 step 2): input checks, code emails, and the real Better Auth set-up on a
// SQLite copy of the schema: codes stored hashed, wrong and right codes, tries per code, session cookie rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuth } from "../../src/lib/account/auth.ts";
import { codeEmail, sendEmail, testMailKey } from "../../src/lib/account/email.ts";
import { checkWelcome, cleanCode, cleanEmail, getRoles, homeFor, saveWelcome } from "../../src/lib/account/roles.ts";
import { ACCOUNT } from "../../src/lib/config.ts";
import { testBucket, testDb } from "./helpers/d1.ts";

test("emails, codes and the welcome step are checked on the server", () => {
  assert.equal(cleanEmail("  Zara.K@Example.COM "), "zara.k@example.com");
  assert.equal(cleanEmail("not an email"), null);
  assert.equal(cleanEmail(`${"a".repeat(250)}@x.com`), null);
  assert.equal(cleanCode("123 456"), "123456");
  assert.equal(cleanCode("12345"), null);
  assert.equal(cleanCode("12a456"), null);
  assert.deepEqual(checkWelcome({ role: "student", firstName: " Zara ", lastName: "Khan-Ali" }), { role: "student", firstName: "Zara", lastName: "Khan-Ali" });
  assert.deepEqual(checkWelcome({ role: "parent", firstName: "Ayşe", lastName: "O'Brien" })?.firstName, "Ayşe");
  assert.equal(checkWelcome({ role: "teacher", firstName: "A", lastName: "B" }), null, "teachers cannot pick themselves yet");
  assert.equal(checkWelcome({ role: "student", firstName: "<b>", lastName: "B" }), null);
  assert.equal(checkWelcome({ role: "student", firstName: "", lastName: "B" }), null);
  assert.equal(homeFor([]), "/welcome");
  assert.equal(homeFor(["parent"]), "/parent");
  assert.equal(homeFor(["parent", "student"]), "/student");
});

test("the code email names the platform, escapes it in HTML, and says how long the code works", () => {
  const m = codeEmail("Prep <Hub>", "z@example.com", "123456");
  assert.equal(m.subject, "123456 is your Prep <Hub> sign-in code");
  assert.match(m.text, new RegExp(`${ACCOUNT.codeMinutes} minutes`));
  assert.ok(m.html.includes("Prep &#60;Hub&#62;") && !m.html.includes("<Hub>"));
});

test("emails go to the local test mailbox, or to Resend with the sender and key", async () => {
  const bucket = testBucket();
  const msg = codeEmail("Prep", "z@example.com", "654321");
  assert.equal(await sendEmail(msg, { platform: "Prep", from: "", apiKey: undefined, local: true, bucket }), "sent");
  assert.ok(new TextDecoder().decode(bucket.objects.get(await testMailKey("Z@example.com"))).includes("654321"));
  assert.equal(await sendEmail(msg, { platform: "Prep", from: "", apiKey: "k", local: false, bucket }), "no_sender");
  assert.equal(await sendEmail(msg, { platform: "Prep", from: "noreply@example.com", apiKey: undefined, local: false, bucket }), "no_key");
  let seen: { url: string; init: RequestInit } | null = null;
  const fetcher = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  assert.equal(await sendEmail(msg, { platform: "Prep", from: "noreply@example.com", apiKey: "re_test", local: false, bucket, fetcher }), "sent");
  const s = seen as unknown as { url: string; init: RequestInit };
  assert.equal(s.url, "https://api.resend.com/emails");
  assert.equal((s.init.headers as Record<string, string>).Authorization, "Bearer re_test");
  assert.equal(JSON.parse(String(s.init.body)).from, "Prep <noreply@example.com>");
  const failing = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
  assert.equal(await sendEmail(msg, { platform: "Prep", from: "noreply@example.com", apiKey: "re_test", local: false, bucket, fetcher: failing }), "failed");
});

function setup() {
  const db = testDb();
  const codes: string[] = [];
  const audits: string[] = [];
  const auth = makeAuth({
    database: db.raw,
    secret: "unit-test-secret-0123456789abcdefghijklmnop",
    baseURL: "http://localhost:8787",
    appName: "Prep",
    sendCode: async (_email, code) => { codes.push(code); },
    audit: async (action) => { audits.push(action); },
  });
  return { db, auth, codes, audits };
}

test("a first sign-in by code creates the account; the code is stored hashed; the cookie is safe", async () => {
  const { db, auth, codes, audits } = setup();
  await auth.api.sendVerificationOTP({ body: { email: "zara@example.com", type: "sign-in" } });
  assert.equal(codes.length, 1);
  assert.match(codes[0] ?? "", new RegExp(`^\\d{${ACCOUNT.codeLength}}$`));
  const stored = db.raw.prepare(`SELECT value FROM "auth_verification"`).all() as { value: string }[];
  assert.equal(stored.length, 1);
  assert.ok(!(stored[0]?.value ?? "").includes(codes[0] ?? "x"), "the code is not stored as typed");

  await assert.rejects(auth.api.signInEmailOTP({ body: { email: "zara@example.com", otp: "000000" === codes[0] ? "111111" : "000000" } }));
  const r = await auth.api.signInEmailOTP({ body: { email: "zara@example.com", otp: codes[0] ?? "" }, returnHeaders: true });
  assert.equal(r.response.user.email, "zara@example.com");
  const cookie = r.headers.getSetCookie().find((c) => c.includes("session_token")) ?? "";
  assert.match(cookie, /^__Secure-acct\.session_token=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, new RegExp(`Max-Age=${ACCOUNT.sessionDays * 86_400}`));
  assert.deepEqual(audits, ["account.created", "account.signin"]);
  const sess = db.raw.prepare(`SELECT "ipAddress" FROM "auth_session"`).all() as { ipAddress: string | null }[];
  assert.ok(!sess[0]?.ipAddress, "no IP addresses are stored");
});

test("a code allows a fixed number of tries, then stops working", async () => {
  const { auth, codes } = setup();
  await auth.api.sendVerificationOTP({ body: { email: "a@example.com", type: "sign-in" } });
  const wrong = codes[0] === "000000" ? "111111" : "000000";
  for (let i = 0; i < ACCOUNT.codeTries; i++) await assert.rejects(auth.api.signInEmailOTP({ body: { email: "a@example.com", otp: wrong } }));
  await assert.rejects(auth.api.signInEmailOTP({ body: { email: "a@example.com", otp: codes[0] ?? "" } }), "even the right code fails after too many tries");
});

test("roles: the welcome step saves names and the role; a second role is another row", async () => {
  const { db, auth, codes } = setup();
  await auth.api.sendVerificationOTP({ body: { email: "p@example.com", type: "sign-in" } });
  const r = await auth.api.signInEmailOTP({ body: { email: "p@example.com", otp: codes[0] ?? "" } });
  const id = r.user.id;
  assert.deepEqual(await getRoles(db, id), []);
  await saveWelcome(db, id, { role: "parent", firstName: "Sara", lastName: "Khan" });
  await saveWelcome(db, id, { role: "parent", firstName: "Sara", lastName: "Khan" });
  assert.deepEqual(await getRoles(db, id), ["parent"]);
  const u = db.raw.prepare(`SELECT "firstName", "lastName", "name" FROM "auth_user" WHERE id = ?`).get(id) as Record<string, string>;
  assert.deepEqual([u.firstName, u.lastName, u.name], ["Sara", "Khan", "Sara Khan"]);
  db.raw.prepare(`DELETE FROM "auth_user" WHERE id = ?`).run(id);
  assert.equal((db.raw.prepare("SELECT count(*) AS n FROM user_role").get() as { n: number }).n, 0, "deleting the account removes its roles");
  assert.equal((db.raw.prepare(`SELECT count(*) AS n FROM "auth_session"`).get() as { n: number }).n, 0, "and its sessions");
});
