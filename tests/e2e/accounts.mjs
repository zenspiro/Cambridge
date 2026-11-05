// Student and parent sign-in at 375 px: email code (from the local test mailbox, never real email), welcome step,
// role homes, sign-out, and attacks on the sign-in endpoints. Needs EMAIL_TRANSPORT=local and BETTER_AUTH_SECRET
// in .dev.vars (see .dev.vars.example).
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};
const net = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
const run = Date.now().toString(36);

/** The newest code mailed to an address, from the local FILES bucket. */
function codeFor(email) {
  const key = `dev-mail/${createHash("sha256").update(email.toLowerCase()).digest("hex")}.json`;
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync("npx", ["wrangler", "r2", "object", "get", `cambridge/${key}`, "--local", "--pipe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = JSON.parse(out).text.match(/sign-in code is (\d{6})/);
      if (m) return m[1];
    } catch { /* the dev server may hold the file for a moment */ }
  }
  return null;
}

const browser = await chromium.launch();

async function signUp(role, first, last) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("401")) errors.push(m.text()); });
  const email = `e2e-${role}-${run}@example.com`;
  await page.goto(BASE + "/signin");
  check((await page.locator("h1").textContent()) === "Sign in", `${role}: the sign-in page opens`);
  check((await page.getByRole("button", { name: "Continue with Google" }).count()) === 0, `${role}: no Google button without its secrets`);
  await page.fill("input[name=email]", email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.waitForSelector("text=We sent a 6-digit code");
  check(true, `${role}: the code step appears in place`);
  const code = codeFor(email);
  check(Boolean(code), `${role}: the code arrived in the local test mailbox`);
  await page.fill("input[name=code]", code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector("text=That code is not right");
  check(true, `${role}: a wrong code is refused`);
  await page.fill("input[name=code]", code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/welcome$/);
  check(true, `${role}: a first sign-in goes to the welcome step`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${role}: welcome has no sideways scroll at 375 px`);
  await page.getByLabel(role === "student" ? "I'm a student" : "I'm a parent").check();
  await page.fill("input[name=firstName]", first);
  await page.fill("input[name=lastName]", last);
  await page.selectOption("select[name=country]", "GB");
  // An adult student (born 2000) needs no parent; the parent flow is in profile.mjs.
  if (role === "student") await page.selectOption("select[name=birthYear]", "2000");
  else check(!(await page.locator("select[name=birthYear]").isVisible()), "parent: no birth year is asked");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(new RegExp(`/${role}$`));
  check((await page.locator("h1").textContent()) === `Hi, ${first}`, `${role}: lands on the ${role} home with their name`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${role}: home has no sideways scroll at 375 px`);
  const cookie = (await ctx.cookies()).find((c) => c.name === "__Secure-acct.session_token");
  check(cookie?.httpOnly && cookie.secure && cookie.sameSite === "Lax", `${role}: the session cookie is HttpOnly, Secure and SameSite=Lax`);
  return { ctx, page, email, errors };
}

const s = await signUp("student", "Zara", "Khan");
check((await s.page.locator(".s-app").getAttribute("data-theme")) === "a", "student: the student home uses the default theme");
await s.page.goto(BASE + "/parent");
check(s.page.url().endsWith("/student"), "student: the parent home sends a student back to their own home");
await s.page.goto(BASE + "/welcome");
check(s.page.url().endsWith("/student"), "student: the welcome step is only shown once");
await s.page.goto(BASE + "/signin");
check(s.page.url().endsWith("/student"), "student: signed in, the sign-in page goes straight home");

// Sign out, then sign in again: straight to the student home this time.
await s.page.getByRole("button", { name: "Sign out" }).click();
await s.page.waitForSelector("text=You are signed out.");
await s.page.goto(BASE + "/student");
check(s.page.url().endsWith("/signin"), "student: after signing out the home is closed");
await s.page.fill("input[name=email]", s.email);
await s.page.getByRole("button", { name: "Send my code" }).click();
await s.page.waitForSelector("text=We sent a 6-digit code");
await s.page.fill("input[name=code]", codeFor(s.email));
await s.page.getByRole("button", { name: "Sign in" }).click();
await s.page.waitForURL(/\/student$/);
check(true, "student: signing in again goes straight to the student home");
check(s.errors.length === 0, `student: no script or CSP errors${s.errors.length ? ": " + s.errors.join(" | ") : ""}`);

const p = await signUp("parent", "Sara", "Khan");
check((await p.page.locator(".s-app").getAttribute("data-theme")) === "c", "parent: the parent home is always the calm look");
check(p.errors.length === 0, `parent: no script or CSP errors${p.errors.length ? ": " + p.errors.join(" | ") : ""}`);

// Attacks and limits, from the student's browser (same origin unless stated).
const api = s.page.request;
const other = await api.post(BASE + "/account/code", { headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, data: { email: s.email } });
check(other.status() === 403, "a code request from another site is refused");
for (const path of ["/api/auth/sign-up/email", "/api/auth/get-session", "/api/auth/email-otp/send-verification-otp"]) {
  check((await api.get(BASE + path)).status() === 404, `Better Auth's ${path} is not exposed`);
}
check((await api.post(BASE + "/api/auth/email-otp/send-verification-otp", { headers: { Origin: BASE }, data: { email: "x@example.com", type: "sign-in" } })).status() === 405 ||
  (await api.post(BASE + "/api/auth/email-otp/send-verification-otp", { headers: { Origin: BASE }, data: { email: "x@example.com", type: "sign-in" } })).status() === 404, "Better Auth's code sender cannot be called directly");
const fresh = `e2e-new-${run}@example.com`;
const a = await (await api.post(BASE + "/account/code", { headers: { Origin: BASE }, data: { email: fresh } })).json();
const b = await (await api.post(BASE + "/account/code", { headers: { Origin: BASE }, data: { email: s.email } })).json();
check(JSON.stringify(a) === JSON.stringify(b), "the answer is the same for a new and a registered email");
let busy = false;
for (let i = 0; i < 6 && !busy; i++) busy = (await (await api.post(BASE + "/account/code", { headers: { Origin: BASE }, data: { email: fresh } })).json()).error === "busy";
check(busy, "too many codes for one email are refused");

await s.ctx.close();
await p.ctx.close();
await browser.close();
process.exit(failures ? 1 : 0);
