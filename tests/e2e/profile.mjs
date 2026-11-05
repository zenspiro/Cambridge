// Phase 1 step 3 at 375 px: parent approval for a minor (approve and decline, from the local test mailbox), the
// country age setting in admin (1400 px), "Me" (exam sessions, theme without reload, details, download, delete).
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PASS = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};
const net = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
const run = Date.now().toString(36);
/** True once the locator shows (the list redraws just after the saved message), false after 10 s. */
const appears = (locator) => locator.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** The newest email to an address in the local test mailbox (FILES bucket), as text. */
function mailTo(email) {
  const key = `dev-mail/${createHash("sha256").update(email.toLowerCase()).digest("hex")}.json`;
  for (let i = 0; i < 3; i++) {
    try {
      return JSON.parse(execFileSync("npx", ["wrangler", "r2", "object", "get", `cambridge/${key}`, "--local", "--pipe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).text;
    } catch { /* retry */ }
  }
  return "";
}

const browser = await chromium.launch();
const phone = () => browser.newContext({ viewport: { width: 375, height: 800 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });

async function student(email, birthYear, country) {
  const ctx = await phone();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/signin");
  await page.fill("input[name=email]", email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.waitForSelector("text=We sent a 6-digit code");
  await page.fill("input[name=code]", mailTo(email).match(/code is (\d{6})/)?.[1] ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/welcome$/);
  await page.getByLabel("I'm a student").check();
  await page.fill("input[name=firstName]", "Zara");
  await page.fill("input[name=lastName]", "Khan");
  await page.selectOption("select[name=country]", country);
  await page.selectOption("select[name=birthYear]", String(birthYear));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");
  return { ctx, page, errors };
}

async function askParent(page, parent) {
  await page.fill("input[name=parentEmail]", parent);
  await page.getByRole("button", { name: /Send the link/ }).click();
  await page.waitForSelector("text=Sent. Ask your parent");
  const link = mailTo(parent).match(/https?:\/\/\S+\/consent\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  return link.replace(/^https?:\/\/[^/]+/, BASE);
}

// 1. A 14-year-old waits, asks a parent, the parent approves with one tap.
const kidEmail = `e2e-kid-${run}@example.com`;
const kid = await student(kidEmail, new Date().getUTCFullYear() - 14, "PK");
check(kid.page.url().endsWith("/student/approval"), "minor: lands on the waiting page");
check(await noScroll(kid.page), "minor: waiting page has no sideways scroll at 375 px");
await kid.page.goto(BASE + "/student");
check(kid.page.url().endsWith("/student/approval"), "minor: the student home stays closed until approved");
await kid.page.goto(BASE + "/me");
check(kid.page.url().endsWith("/student/approval"), "minor: Me stays closed until approved");
await kid.page.fill("input[name=parentEmail]", kidEmail);
await kid.page.getByRole("button", { name: /Send the link/ }).click();
await kid.page.waitForSelector("text=That is your own email");
check(true, "minor: their own email is refused as the parent's");
const parentEmail = `e2e-mum-${run}@example.com`;
const link = await askParent(kid.page, parentEmail);
check(link.includes("/consent/"), "minor: the parent's email has a one-tap link");
check(await appears(kid.page.getByText(`We emailed ${parentEmail}`)), "minor: the page shows who was emailed, without a reload");

const mum = await phone();
const mp = await mum.newPage();
await mp.goto(link);
check((await mp.locator("h1").textContent())?.includes("Approve Zara Khan"), "parent: the link opens the approval page with the child's name");
check((await mp.locator(".s-app").getAttribute("data-theme")) === "c", "parent: the approval page uses the calm look");
check(await noScroll(mp), "parent: approval page has no sideways scroll at 375 px");
await mp.getByRole("button", { name: "Approve" }).click();
await mp.waitForURL(/\/consent\/done\?r=approved$/);
check(await mp.getByText("Your child can now use").isVisible(), "parent: approving thanks them and offers a parent account");
await mp.goto(link);
check(await mp.getByText("already been answered").isVisible(), "parent: the link works only once");
await mum.close();

await kid.page.goto(BASE + "/student/approval");
check(kid.page.url().endsWith("/student"), "minor: after approval the student home opens");

// 2. Student home and Me.
check(await kid.page.getByText("When are your exams?").isVisible(), "home: asks once when the exams are");
await kid.page.getByRole("button", { name: "Skip for now" }).click();
await kid.page.waitForSelector("text=When are your exams?", { state: "detached" });
await kid.page.reload();
check((await kid.page.getByText("When are your exams?").count()) === 0, "home: skipping hides the question");
await kid.page.goto(BASE + "/me");
check(await noScroll(kid.page), "me: no sideways scroll at 375 px");
await kid.page.selectOption("select[name=code]", "0625");
await kid.page.selectOption("select[name=session]", "s");
await kid.page.selectOption("select[name=year]", String(new Date().getUTCFullYear() + 1));
await kid.page.getByRole("button", { name: "Add exam" }).click();
await kid.page.waitForSelector("text=Exam session saved.");
check(await appears(kid.page.getByText(/Physics \(0625\): June/)), "me: an exam session is added in place");
await kid.page.evaluate(() => { window.__noReload = true; });
await kid.page.getByRole("button", { name: "Playful" }).click();
await kid.page.waitForFunction(() => document.querySelector(".s-app")?.getAttribute("data-theme") === "b");
check(await kid.page.evaluate(() => window.__noReload === true), "me: the theme changes without a reload");
await kid.page.goto(BASE + "/student");
check((await kid.page.locator(".s-app").getAttribute("data-theme")) === "b", "me: the theme is remembered");
check(await appears(kid.page.getByText(/June \d{4}/)), "home: shows the exam session");
await kid.page.goto(BASE + "/me");
await kid.page.fill("input[name=firstName]", "Zaraa");
await kid.page.getByRole("button", { name: "Save" }).click();
await kid.page.waitForSelector("text=Saved.");
check(await kid.page.getByText("approved by a parent").isVisible(), "me: the birth year is locked after approval");
const dl = await kid.page.request.get(BASE + "/account/export");
const data = await dl.json();
check(dl.headers()["content-disposition"]?.includes("attachment") && data.account?.email === kidEmail && data.exam_plans?.length === 1, "me: Download my data gives a file with their data");
check(!JSON.stringify(data).includes("token"), "me: the download has no tokens");
await kid.page.getByRole("button", { name: "Delete my account" }).click();
await kid.page.getByRole("button", { name: "Yes, delete" }).click();
await kid.page.waitForURL(/\/signin\?e=ok_deleted$/);
check(await kid.page.getByText("has been deleted").isVisible(), "me: deleting the account signs out and says so");
await kid.page.goto(BASE + "/student");
check(kid.page.url().endsWith("/signin"), "me: the deleted account is closed");
check(kid.errors.length === 0, `minor: no script errors${kid.errors.length ? ": " + kid.errors.join(" | ") : ""}`);
await kid.ctx.close();

// 3. A parent declines: the student's account is deleted.
const kid2 = await student(`e2e-kid2-${run}@example.com`, new Date().getUTCFullYear() - 13, "AE");
const link2 = await askParent(kid2.page, `e2e-dad-${run}@example.com`);
const dad = await phone();
const dp = await dad.newPage();
await dp.goto(link2);
await dp.getByRole("button", { name: "Decline" }).click();
await dp.getByRole("button", { name: "Yes, decline" }).click();
await dp.waitForURL(/\/consent\/done\?r=declined$/);
check(await dp.getByText("has been deleted").isVisible(), "parent: declining deletes the account and says so");
await dad.close();
await kid2.page.goto(BASE + "/student");
check(kid2.page.url().endsWith("/signin"), "decline: the student is signed out (account gone)");
await kid2.ctx.close();

// 4. Admin: a country with a lower age limit lets a 17-year-old in straight away.
const admin = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
const ap = await admin.newPage();
await ap.goto(BASE + "/admin/login");
await ap.fill("#password", PASS);
await ap.click("button[type=submit]");
await ap.waitForURL(BASE + "/admin");
await ap.goto(BASE + "/admin/settings");
const add = ap.locator("form[action='/admin/settings/consent/country']");
await add.locator("select[name=country]").selectOption("SA");
await add.locator("input[name=age]").fill("16");
await add.getByRole("button", { name: "Add" }).click();
await ap.waitForSelector("text=Saudi Arabia: under 16");
check(true, "admin: a country age limit is added in place");
const teen = await student(`e2e-teen-${run}@example.com`, new Date().getUTCFullYear() - 17, "SA");
check(teen.page.url().endsWith("/student"), "admin: a 17-year-old in that country needs no parent");
await teen.ctx.close();
await ap.locator("form[action='/admin/settings/consent/remove'] button").first().click();
await ap.waitForSelector("text=None: every country uses the age above.");
check(await noScroll(ap), "admin: settings has no sideways scroll at 1400 px");
await admin.close();

await browser.close();
process.exit(failures ? 1 : 0);
