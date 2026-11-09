// Browser test of team access (owner, 9 Nov 2026) against a running Worker: the owner invites someone with access to
// one subject; the invite arrives in the local test mailbox; they sign in with the email code, accept, and see only
// their part of the admin; owner-only pages stay closed; pausing closes the admin to them.
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
let nextNet = Math.floor(Math.random() * 200);
const net = () => `192.0.2.${(nextNet++ % 250) + 1}`;
const run = Date.now().toString(36);
const email = `e2e-team-${run}@example.com`;

/** The newest mail to an address from the local FILES bucket, or null. */
function mailTo(address) {
  const key = `dev-mail/${createHash("sha256").update(address.toLowerCase()).digest("hex")}.json`;
  for (let i = 0; i < 3; i++) {
    try {
      return JSON.parse(execFileSync("npx", ["wrangler", "r2", "object", "get", `cambridge/${key}`, "--local", "--pipe"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch { /* the dev server may hold the file for a moment */ }
  }
  return null;
}

const browser = await chromium.launch();
try {
  // The owner invites: library view, source review edit, Physics (0625) only.
  const owner = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": net() } })).newPage();
  await owner.goto(BASE + "/admin/login");
  await owner.fill("#password", PASS);
  await owner.click("form[action='/admin/session'] button");
  await owner.waitForURL(BASE + "/admin");
  check((await owner.locator(".admin-side a[href='/admin/users/team']").count()) === 1 && (await owner.locator(".admin-side .side-run").count()) === 0, "the owner's menu has Users > Team; no runs in the sidebar");
  await owner.goto(BASE + "/admin/users/team");
  const form = owner.locator("#invite form");
  await form.locator("input[name=name]").fill("Ayesha Team");
  await form.locator("input[name=email]").fill(email);
  await form.locator("select[name=library]").selectOption("view");
  await form.locator("select[name=sourceReview]").selectOption("edit");
  await form.locator("input[name=subject][value='0625']").check();
  await form.locator("button", { hasText: "Send invite" }).click();
  await owner.locator("#invite .action-note", { hasText: "Invite sent" }).waitFor({ timeout: 10_000 }).then(() => check(true, "an invite is sent in place"), () => check(false, "an invite is sent in place"));
  await owner.locator(`#invites tr[data-invite="${email}"]`).waitFor({ timeout: 10_000 }).catch(() => {});
  check((await owner.locator(`#invites tr[data-invite="${email}"]`).textContent())?.includes("Library: view only; Source review: view and edit; 0625"), "the waiting invite shows its access in words");
  const mail = mailTo(email);
  const link = mail?.text.match(/Accept here: (\S+)/)?.[1] ?? "";
  check(/\/team\/join\/[A-Za-z0-9_-]{20,}$/.test(link) && mail.subject.includes("invited"), "the invite email has a one-time link");

  // The invited person: signs in with the code from their email, comes back and accepts.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
  const team = await ctx.newPage();
  const errors = [];
  team.on("pageerror", (e) => errors.push(e.message));
  await team.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  check((await team.locator("#team-join").textContent())?.includes("Ayesha Team, you are invited"), "the invite page says who is invited and their access");
  await team.locator("#team-join a", { hasText: "Sign in to accept" }).click();
  await team.fill("input[name=email]", email);
  await team.getByRole("button", { name: "Send my code" }).click();
  await team.waitForSelector("text=We sent a 6-digit code");
  const code = mailTo(email)?.text.match(/sign-in code is (\d{6})/)?.[1] ?? "";
  await team.fill("input[name=code]", code);
  await team.getByRole("button", { name: "Sign in" }).click();
  await team.waitForURL(/\/team\/join\//, { timeout: 10_000 }).then(() => check(true, "after signing in they come back to the invite, not the student welcome"), () => check(false, "after signing in they come back to the invite"));
  await team.locator("#team-join button", { hasText: "Accept and open the admin" }).click();
  await team.waitForURL(BASE + "/admin", { timeout: 10_000 }).then(() => check(true, "Accept opens the admin"), () => check(false, `Accept opens the admin (${team.url()})`));
  check((await team.locator("h1").textContent())?.startsWith("Welcome, ") && (await team.locator("#my-access").textContent())?.includes("0625"), "a team member's Home shows their access");
  const menu = await team.locator(".admin-side .side-link").allTextContents();
  check(menu.join("|") === "Home|Library", `their menu has only what they may use (${menu.join("|")})`);
  check((await team.locator(".admin-side").textContent())?.includes("Signed in as") && (await team.locator(".ai-meter").count()) === 0, "the sidebar says who is signed in, without the owner's AI meter");
  await team.goto(BASE + "/admin/library");
  const cards = await team.locator("a[href^='/admin/library/0']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href").split("/")[3]))]);
  check(cards.length === 1 && cards[0] === "0625" && (await team.locator(".page-actions a", { hasText: "Upload" }).count()) === 0, `the library shows only their subject, with no upload buttons (${cards.join(",")})`);
  await team.goto(BASE + "/admin/library/0625");
  check((await team.locator("#read-all").count()) === 0 && (await team.locator("#variants").count()) === 0 && (await team.locator(".page-actions a", { hasText: "Run the agent" }).count()) === 0, "the subject page hides Read all, the agent and essential variants");
  await team.goto(BASE + "/admin/library/0620");
  check(team.url().endsWith("/admin?e=no_access") && (await team.locator(".notice, .alert").first().textContent())?.includes("not part of your access"), "another subject is refused and Home says why");
  await team.goto(BASE + "/admin/ai");
  check(team.url().includes("/admin/login"), "owner pages stay closed (AI setup)");
  await team.goto(BASE + "/admin/users/team");
  check(team.url().includes("/admin/login"), "owner pages stay closed (Team)");
  const post = await team.request.post(BASE + "/admin/users/team/invite", { form: { name: "X", email: "x@example.com", library: "edit" }, headers: { origin: BASE }, maxRedirects: 0 });
  check((post.headers()["location"] ?? "").includes("/admin/login"), "a team member cannot invite (the server refuses, not just the button)");
  const upload = await team.request.post(BASE + "/admin/library/folder/file", { data: Buffer.from("%PDF-1.4\n"), headers: { origin: BASE, "x-file-name": "0625_s24_qp_22.pdf", "content-type": "application/pdf" } });
  check(upload.status() === 401, `view-only cannot upload (${upload.status()})`);

  // The owner pauses them: the admin closes; then removes them.
  await owner.goto(BASE + "/admin/users/team");
  const row = owner.locator(`.member-row[data-member="${email}"]`);
  check((await row.count()) === 1 && (await row.textContent())?.includes("Active"), "the member is listed as active");
  await row.locator("button", { hasText: "Pause" }).click();
  await row.locator(".pill", { hasText: "Paused" }).waitFor({ timeout: 10_000 }).then(() => check(true, "Pause works in place"), () => check(false, "Pause works in place"));
  await team.goto(BASE + "/admin");
  check(team.url().includes("/admin/login"), "a paused member cannot open the admin");
  await owner.goto(BASE + "/admin/users/accounts?role=team");
  check((await owner.locator("#accounts").textContent())?.includes(email), "Students and parents lists every account, team members marked");
  await owner.goto(BASE + "/admin/users/team");
  const again = owner.locator(`.member-row[data-member="${email}"]`);
  await again.locator("button", { hasText: "Remove" }).click();
  await again.locator(".confirm button", { hasText: "Yes, remove" }).click();
  await again.waitFor({ state: "detached", timeout: 10_000 }).then(() => check(true, "Remove asks first, then takes them off the team"), () => check(false, "Remove asks first, then takes them off the team"));
  check(errors.length === 0, `no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall team checks passed");
process.exit(failures ? 1 : 0);
