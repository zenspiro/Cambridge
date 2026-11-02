// Browser test of the source library against a running Worker (default http://localhost:8787).
// Signs in with the local .dev.vars password, uploads, browses the library, adds a missing file, checks sources.
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

  // Library home: qualifications and subject cards with status.
  await page.goto(BASE + "/admin/library");
  check((await page.locator("h2", { hasText: "Cambridge IGCSE" }).count()) === 1, `${width}px library groups by qualification`);
  check((await page.locator(".card-link", { hasText: "0625" }).locator(".pill").count()) === 1, `${width}px subject card shows its status`);
  check((await page.locator("text=No subjects yet").count()) === 2, `${width}px empty qualifications are shown`);
  await noOverflow("library home");

  // Search across the library.
  await page.fill("#q", good);
  await page.click("form[role=search] button[type=submit]");
  await page.waitForURL(/\?q=/);
  check((await page.locator(".list-row", { hasText: good }).count()) === 1, `${width}px search finds the file`);

  // Subject overview: status, grid of sessions, versions, papers.
  await page.goto(BASE + "/admin/library/0625");
  check((await page.locator("nav.crumbs", { hasText: "Cambridge IGCSE" }).count()) === 1, `${width}px breadcrumb shows the hierarchy`);
  check((await page.locator("table.year-grid a.tile").count()) >= 10, `${width}px overview grid has a tile per session`);
  check((await page.locator("table.year-grid tbody tr").count()) === 5, `${width}px one grid row per library year`);
  check((await page.locator(".info-table", { hasText: "Multiple Choice (Extended)" }).count()) === 1, `${width}px papers table names the papers`);
  check((await page.locator(".routes", { hasText: "Paper 2 + Paper 4 + (Paper 5 or Paper 6), grades A* to G" }).count()) === 1, `${width}px routes are shown`);
  check((await page.locator("a.cell").count()) <= 10, `${width}px overview stays short (no file tables)`);
  await noOverflow("subject overview");

  // A session page: papers with names, tier tags, essential variant 2 first.
  await page.locator('a.tile[aria-label^="June 2024"]').click();
  await page.waitForURL(/\/admin\/library\/0625\/2024\/june$/);
  check((await page.locator("nav.crumbs", { hasText: "June 2024" }).count()) === 1, `${width}px session page has its breadcrumb`);
  check((await page.locator("h2", { hasText: "Essential: variant 2" }).count()) === 1, `${width}px variant 2 is essential`);
  check((await page.locator("table.grid-table tbody tr").first().textContent())?.includes("Multiple Choice (Core)"), `${width}px rows carry paper names`);
  check((await page.locator(".tag-extended").count()) > 0, `${width}px Extended papers are tagged`);
  check((await page.locator("nav.pager a").count()) >= 1, `${width}px session pager links to other sessions`);
  await noOverflow("session page");
  check((await page.request.get(BASE + "/admin/library/0625/2024/autumn")).status() === 404, `${width}px unknown session name is not found`);
  await page.goto(BASE + "/admin/library/0625/version/2023");
  check((await page.locator("h2", { hasText: "Specimen papers" }).count()) === 1, `${width}px version page lists specimens`);
  await noOverflow("version page");

  // Search inside the subject: plain-word results; the file downloads.
  await page.goto(BASE + `/admin/library/0625?q=${encodeURIComponent(good)}`);
  const cellLink = page.locator(`a[title^="${good}:"]`);
  check((await cellLink.count()) === 1, `${width}px the file shows in the search results`);
  check((await page.locator(".result-row", { hasText: good }).textContent())?.includes("Paper "), `${width}px results are described in words`);
  const [download] = await Promise.all([page.waitForEvent("download"), cellLink.click()]);
  check(download.suggestedFilename() === good, `${width}px download is an attachment with the right name`);

  await page.goto(BASE + "/admin/library/0625?year=2099&type=%3Cscript%3E&paper=9&status=x");
  check((await page.locator("table.year-grid").count()) === 1, `${width}px junk filters are ignored safely`);
  await page.goto(BASE + "/admin/library/0625?status=missing");
  check((await page.locator(".result-row .cell-have").count()) === 0 && (await page.locator(".result-row .cell-miss").count()) > 0, `${width}px Missing filter shows only missing essentials`);
  await page.goto(BASE + "/admin/library/0625?q=mark+scheme+paper+4&year=2024");
  const shown = await page.locator(".result-row a.cell").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
  check(shown.length > 0 && shown.every((t) => /^0625_[msw]24_ms_4\d\.pdf:/.test(t)), `${width}px search inside a subject narrows the list`);
  await page.goto(BASE + "/admin/library/9999");
  check(page.url().includes("e=unknown"), `${width}px unknown syllabus goes back to the library`);

  if (width === 1400) {
    // Essential variants per syllabus.
    await page.goto(BASE + "/admin/library/0625");
    for (const sess of ["m", "s", "w"]) for (const v of ["1", "2", "3"]) await page.uncheck(`input[name=ev_${sess}][value='${v}']`);
    await page.click("form[action='/admin/library/variants'] button");
    await page.waitForURL(/e=bad_variants/);
    check((await page.locator("p.alert").count()) === 1, "variants: none ticked is refused");
    for (const sess of ["m", "s", "w"]) await page.check(`input[name=ev_${sess}][value='2']`);
    await page.click("form[action='/admin/library/variants'] button");
    await page.waitForURL(/e=ok_variants/);
    check((await page.locator("p.notice", { hasText: "Essential variants saved" }).count()) === 1, "variants: saved");
  }

  if (width === 375) {
    // Add a missing essential file from its cell, with any file name.
    await page.goto(BASE + "/admin/library/0625?status=missing");
    const missing = page.locator("a.cell-miss").first();
    const target = (await missing.getAttribute("title")).split(":")[0];
    await missing.click();
    await page.waitForURL(/\/admin\/library\/add\?file=/);
    check((await page.locator("p.mono", { hasText: target }).count()) === 1, `add page names the file: ${target}`);
    check(/(Paper \d [A-Z]|examiner report|grade thresholds|syllabus)/i.test((await page.locator("section h2").first().textContent()) ?? ""), "add page describes the file in words");
    await page.fill("#url", "https://evil.example/paper.pdf");
    await page.click("form[action='/admin/library/add/link'] button");
    await page.waitForURL(/e=not_approved/);
    check((await page.locator("p.alert").textContent())?.includes("approved source"), "link from an unapproved site is refused");
    const any = join(dir, "my scan (final).pdf");
    writeFileSync(any, `%PDF-1.4\n% add ${Date.now()} ${Math.random()}\n%%EOF`);
    await page.setInputFiles("#file", any);
    await page.click("form[action='/admin/library/add/upload'] button");
    await page.waitForURL(/\/admin\/library\/0625\?e=ok_added/);
    await page.goto(BASE + `/admin/library/0625?q=${encodeURIComponent(target)}`);
    check((await page.locator(`a.cell-have[title^="${target}:"]`).count()) === 1, "added file is saved under the checklist name and ticked");
    await noOverflow("add flow");
  }

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
for (const p of ["/admin/library", "/admin/library/0625", "/admin/library/0625/2024/june", "/admin/library/0625/version/2023", "/admin/library/add?file=0625_s24_qp_11.pdf", "/admin/library/upload", "/admin/sources", "/admin/library/file/aaaaaaaaaaaaaaaa"]) {
  const r = await api.get(p);
  check([303, 307].includes(r.status()) && (r.headers()["location"] ?? "").endsWith("/admin/login"), `signed out: ${p} redirects to sign-in`);
}
const forged = await api.get("/admin/library/file/aaaaaaaaaaaaaaaa", { headers: { cookie: "__Host-admin=forgedtoken123" } });
check(forged.status() !== 200, "forged cookie cannot download");
for (const p of ["/admin/library/upload/send", "/admin/library/add/upload", "/admin/library/add/link", "/admin/library/variants", "/admin/sources/add", "/admin/sources/remove"]) {
  const r = await api.post(p, { headers: { origin: "https://evil.example" }, form: { id: "cambridge-official" } });
  check(r.status() === 403, `cross-site POST to ${p} refused`);
  const r2 = await api.post(p, { headers: { origin: BASE }, form: { id: "cambridge-official" } });
  check((r2.headers()["location"] ?? "").endsWith("/admin/login"), `signed-out POST to ${p} goes to sign-in`);
}

await api.dispose();
await browser.close();
process.exit(failures ? 1 : 0);
