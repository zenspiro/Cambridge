// Browser test of the source library against a running Worker (default http://localhost:8787).
// Signs in with the local .dev.vars password, uploads, browses, downloads, checks gaps and sources.
import { chromium, request as apiRequest } from "playwright";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PASS = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const rnd = (n) => Math.floor(Math.random() * n);

// Test files: a valid PDF with a random valid name, a bad name, and a fake PDF.
const dir = mkdtempSync(join(tmpdir(), "lib-e2e-"));
const good = `0625_${["m", "s", "w"][rnd(3)]}${22 + rnd(4)}_qp_${1 + rnd(6)}${1 + rnd(3)}.pdf`;
writeFileSync(join(dir, good), `%PDF-1.4\n% e2e ${Date.now()} ${Math.random()}\n%%EOF`);
writeFileSync(join(dir, "holiday-photo.pdf"), "%PDF-1.4\n%%EOF");
writeFileSync(join(dir, "0625_s24_ms_21.pdf"), "<html>not a pdf</html>");

const browser = await chromium.launch();
for (const width of [375, 1400]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { "cf-connecting-ip": `203.0.113.${1 + rnd(250)}` } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const noOverflow = async (label) =>
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${width}px ${label}: no sideways scroll`);

  await page.goto(BASE + "/admin/login");
  await page.fill("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL(BASE + "/admin");

  if (width === 375) {
    await page.goto(BASE + "/admin/library/upload");
    await page.setInputFiles("#files", [join(dir, good), join(dir, "holiday-photo.pdf"), join(dir, "0625_s24_ms_21.pdf")]);
    await page.click("form[action='/admin/library/upload/send'] button[type=submit]");
    await page.waitForURL(/\/admin\/library\/upload\?job=/);
    const rows = await page.locator(".list-row").allTextContents();
    check(rows.some((r) => r.includes(good) && /Stored|Already in the library/.test(r)), `upload: ${good} stored`);
    check(rows.some((r) => r.includes("holiday-photo.pdf") && r.includes("Not a Cambridge file name")), "upload: bad name rejected");
    check(rows.some((r) => r.includes("0625_s24_ms_21.pdf") && r.includes("Not a PDF")), "upload: fake PDF rejected");
    await noOverflow("upload results");
  }

  await page.goto(BASE + "/admin/library");
  check((await page.locator(".mono", { hasText: good }).count()) === 1, `${width}px library lists the file`);
  await noOverflow("library");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".list-row", { hasText: good }).locator("a", { hasText: "Download" }).click(),
  ]);
  check(download.suggestedFilename() === good, `${width}px download is an attachment with the right name`);

  await page.goto(BASE + "/admin/library?year=2099&type=%3Cscript%3E&paper=9");
  check((await page.locator(".mono", { hasText: good }).count()) === 1, `${width}px junk filters are ignored safely`);

  await page.goto(BASE + "/admin/library/gaps");
  check((await page.locator(".pill").count()) > 0, `${width}px gap report renders`);
  await noOverflow("gaps");

  await page.goto(BASE + "/admin/sources");
  check((await page.locator(".doc-main", { hasText: "Cambridge International (official)" }).count()) === 1, `${width}px sources lists Cambridge`);
  await noOverflow("sources");

  if (width === 1400) {
    await page.fill("#name", "Test site");
    await page.fill("#url", "https://127.0.0.1/");
    await page.click("text=Add source");
    check((await page.locator("p.alert").textContent())?.includes("https address"), "sources: IP address refused");
    const host = `e2e-${Date.now()}.example.org`;
    await page.fill("#name", "Test site");
    await page.fill("#url", `https://${host}/papers`);
    await page.click("text=Add source");
    check((await page.locator("p.notice").textContent())?.includes("added"), "sources: added");
    const row = page.locator(".list-row", { hasText: host });
    await row.locator("text=Switch off").click();
    check((await page.locator(".list-row", { hasText: host }).locator(".pill").textContent()) === "Off", "sources: switched off");
    const removeLink = () => page.locator(".list-row", { hasText: host }).getByRole("link", { name: "Remove", exact: true });
    await removeLink().click();
    await page.waitForURL(/remove=/);
    check((await page.getByText("Remove this source?").count()) === 1, "sources: inline confirm shows");
    await page.getByRole("link", { name: "Never mind" }).click();
    await page.waitForURL(BASE + "/admin/sources");
    check((await page.locator(".list-row", { hasText: host }).count()) === 1, "sources: Never mind keeps it");
    await removeLink().click();
    await page.waitForURL(/remove=/);
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await page.waitForURL(/e=ok_removed/);
    check((await page.locator(".list-row", { hasText: host }).count()) === 0, "sources: removed");
  }
  check(errors.length === 0, `${width}px no script or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// Signed out: nothing in the library is reachable.
const api = await apiRequest.newContext({ baseURL: BASE, maxRedirects: 0 });
for (const p of ["/admin/library", "/admin/library/gaps", "/admin/library/upload", "/admin/sources", "/admin/library/file/aaaaaaaaaaaaaaaa"]) {
  const r = await api.get(p);
  check([303, 307].includes(r.status()) && (r.headers()["location"] ?? "").endsWith("/admin/login"), `signed out: ${p} redirects to sign-in`);
}
const forged = await api.get("/admin/library/file/aaaaaaaaaaaaaaaa", { headers: { cookie: "__Host-admin=forgedtoken123" } });
check(forged.status() !== 200, "forged cookie cannot download");
for (const p of ["/admin/library/upload/send", "/admin/sources/add", "/admin/sources/remove"]) {
  const r = await api.post(p, { headers: { origin: "https://evil.example" }, form: { id: "cambridge-official" } });
  check(r.status() === 403, `cross-site POST to ${p} refused`);
  const r2 = await api.post(p, { headers: { origin: BASE }, form: { id: "cambridge-official" } });
  check((r2.headers()["location"] ?? "").endsWith("/admin/login"), `signed-out POST to ${p} goes to sign-in`);
}

await api.dispose();
await browser.close();
process.exit(failures ? 1 : 0);
