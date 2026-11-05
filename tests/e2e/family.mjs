// Families at 375 px: family code and joining on Me, a parent-made child account, approving a waiting child from
// the parent home (who then joins by themselves), download, remove, delete, and leaving (adults only).
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
const YEAR = new Date().getUTCFullYear();
const appears = (l) => l.first().waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
const goes = (l) => l.first().waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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
const errors = [];

/** Signs in by code; `welcome` fills the first-time step when given. */
async function signIn(email, welcome) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/signin");
  await page.fill("input[name=email]", email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.waitForSelector("text=We sent a 6-digit code");
  await page.fill("input[name=code]", mailTo(email).match(/code is (\d{6})/)?.[1] ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
  await page.waitForLoadState("networkidle");
  if (welcome) {
    await page.waitForURL(/\/welcome$/);
    await page.getByLabel(welcome.role === "student" ? "I'm a student" : "I'm a parent").check();
    await page.fill("input[name=firstName]", welcome.first);
    await page.fill("input[name=lastName]", "Khan");
    await page.selectOption("select[name=country]", "PK");
    if (welcome.role === "student") await page.selectOption("select[name=birthYear]", String(welcome.born));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
  }
  return { ctx, page };
}

// The parent.
const mumEmail = `e2e-fam-mum-${run}@example.com`;
const mum = await signIn(mumEmail, { role: "parent", first: "Sara" });
check(mum.page.url().endsWith("/parent") && (await mum.page.getByText("No children yet").isVisible()), "parent: an empty family to start with");
check(await noScroll(mum.page), "parent: home has no sideways scroll at 375 px");
await mum.page.getByRole("button", { name: "Make a family code" }).click();
check(await appears(mum.page.locator(".s-code")), "parent: a family code is made in place");
const code = (await mum.page.locator(".s-code").textContent()) ?? "";

// A parent-made child account.
const zaraEmail = `e2e-fam-zara-${run}@example.com`;
await mum.page.locator("summary", { hasText: "Make an account for your child" }).click();
const form = mum.page.locator("form[action='/account/family/child']");
await form.locator("input[name=firstName]").fill("Zara");
await form.locator("input[name=lastName]").fill("Khan");
await form.locator("input[name=email]").fill(zaraEmail);
await form.locator("select[name=country]").selectOption("PK");
await form.locator("select[name=birthYear]").selectOption(String(YEAR - 13));
await form.getByRole("button", { name: "Make the account" }).click();
check(await appears(mum.page.getByRole("article", { name: "Zara Khan" })), "parent: the child's account shows in the family");
const zara = await signIn(zaraEmail, null);
check(zara.page.url().endsWith("/student"), "child: a parent-made account signs in straight to the home (approved)");
await zara.page.goto(BASE + "/me");
check(await zara.page.getByText("You are in Sara Khan's family").isVisible(), "child: Me shows the family");
check((await zara.page.getByRole("button", { name: "Leave the family" }).count()) === 0, "child: under the age limit there is no leave button");

// An adult student joins by code and may leave.
const omar = await signIn(`e2e-fam-omar-${run}@example.com`, { role: "student", first: "Omar", born: 2000 });
await omar.page.goto(BASE + "/me");
await omar.page.fill("form[action='/account/family/join'] input[name=code]", "WRONG234");
await omar.page.getByRole("button", { name: "Join" }).click();
check(await appears(omar.page.getByText("That code does not work")), "join: a wrong code is refused");
await omar.page.fill("form[action='/account/family/join'] input[name=code]", code);
await omar.page.getByRole("button", { name: "Join" }).click();
check(await appears(omar.page.getByText("You are in Sara Khan's family")), "join: the right code joins the family in place");
await omar.page.getByRole("button", { name: "Leave the family" }).click();
await omar.page.locator(".confirm").getByRole("button", { name: "Yes" }).click();
check(await appears(omar.page.locator("form[action='/account/family/join']")), "leave: an adult can leave (inline confirm)");
check(await noScroll(omar.page), "me: no sideways scroll at 375 px");
await omar.ctx.close();

// A minor asks this parent; the parent approves from home and the child joins by itself.
const ali = await signIn(`e2e-fam-ali-${run}@example.com`, { role: "student", first: "Ali", born: YEAR - 12 });
await ali.page.fill("input[name=parentEmail]", mumEmail);
await ali.page.getByRole("button", { name: /Send the link/ }).click();
await ali.page.waitForSelector("text=Sent. Ask your parent");
await mum.page.goto(BASE + "/parent");
check(await mum.page.getByText("Ali Khan is waiting for you").isVisible(), "parent: a waiting child shows on the home");
await mum.page.getByRole("button", { name: "Approve" }).click();
check(await appears(mum.page.getByRole("article", { name: "Ali Khan" })), "parent: approving from home adds the child to the family");
await ali.page.goto(BASE + "/student");
check(ali.page.url().endsWith("/student"), "child: approved from the parent home, the student home opens");
await ali.ctx.close();

// Download, remove, delete.
const zaraId = await mum.page.getByRole("article", { name: "Zara Khan" }).locator("input[name=child]").first().inputValue();
const dl = await mum.page.request.get(`${BASE}/account/family/export?child=${encodeURIComponent(zaraId)}`);
check(dl.status() === 200 && (await dl.json()).account?.email === zaraEmail, "parent: downloads their child's data");
check((await mum.page.request.get(`${BASE}/account/family/export?child=nobody-at-all`)).status() === 404, "parent: no data for someone outside the family");
const aliCard = mum.page.getByRole("article", { name: "Ali Khan" });
await aliCard.getByRole("button", { name: "Remove" }).click();
await aliCard.locator(".confirm").getByRole("button", { name: "Yes" }).click();
check(await goes(mum.page.getByRole("article", { name: "Ali Khan" })), "parent: remove takes the child out (inline confirm)");
const zaraCard = mum.page.getByRole("article", { name: "Zara Khan" });
await zaraCard.getByRole("button", { name: "Delete account" }).click();
await zaraCard.getByRole("button", { name: "Yes, delete" }).click();
await mum.page.waitForURL(/e=ok_deleted/);
check(await mum.page.getByText("everything in it has been deleted").isVisible(), "parent: deleting a child's account says so");
await zara.page.goto(BASE + "/student");
check(zara.page.url().endsWith("/signin"), "child: the deleted account is closed");
check(errors.length === 0, `family: no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);

await zara.ctx.close();
await mum.ctx.close();
await browser.close();
process.exit(failures ? 1 : 0);
