// Agent test against a running Worker (http://localhost:8787) and a fake source website.
// Uses the local D1 (wrangler d1 execute --local) to set up runs, since GitHub is not
// called locally. Never contacts Cambridge: the real source is switched off during the test.
import { chromium, request as apiRequest } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { startFakeSource } from "./fake-source.mjs";
import { signRequest } from "../../src/lib/agent/sign.ts";

const BASE = "http://localhost:8787";
const vars = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8");
const PASS = vars.match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
const SECRET = vars.match(/^AGENT_SECRET=(.*)$/m)?.[1]?.trim();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const sql = (q) => execFileSync("npx", ["wrangler", "d1", "execute", "cambridge", "--local", "--json", "--command", q], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rows = (q) => JSON.parse(sql(q))[0].results;
const id = () => `e2e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const fake = await startFakeSource();
sql(`UPDATE source_site SET enabled = 0 WHERE id = 'cambridge-official'`);
sql(`DELETE FROM source_document WHERE source_site_id = 'local-test' OR file_name IN ('0625_s24_qp_11.pdf','0625_s24_ms_11.pdf','0625_s24_er.pdf','0625_y23_sp_1.pdf')`);
sql(`INSERT OR REPLACE INTO source_site (id, name, base_url, enabled, notes, created_at) VALUES ('local-test', 'Local test site', '${fake.base}', 1, '', 1)`);
sql(`INSERT OR REPLACE INTO source_page (id, site_id, syllabus_code, url, created_at) VALUES ('local-test-page', 'local-test', '0625', '${fake.base}papers/0625/', 1)`);
sql(`UPDATE job SET status = 'failed' WHERE type = 'agent' AND status IN ('queued', 'running')`);

// Async spawn: the fake source runs in this process and must keep answering.
const runAgent = (jobId) =>
  new Promise((resolve) => {
    const child = spawn("node", ["scripts/agent/run.ts"], {
      env: { ...process.env, APP_URL: BASE, AGENT_SECRET: SECRET, JOB_ID: jobId, AGENT_TEST_MODE: "1", AGENT_DELAY_MS: "50" },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stderr }));
  });
const newRun = (mode) => {
  const j = id();
  sql(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('${j}', 'agent', 'queued', '{"code":"0625","years":[2024,2023],"sessions":["s","y"],"mode":"${mode}"}', 'platform-admin', ${Date.now()})`);
  return j;
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": `203.0.113.${1 + Math.floor(Math.random() * 250)}` } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "/admin/login");
  await page.fill("#password", PASS);
  await page.click("form[action='/admin/session'] button");
  await page.waitForURL(BASE + "/admin");

  // 1. The Run button without a GitHub token: the run is closed with a clear message.
  await page.goto(BASE + "/admin/agent");
  await page.check("input[name=years][value='2024']");
  await page.check("input[name=sessions][value='s']");
  await page.click("form[action='/admin/agent/start'] button[type=submit]");
  await page.waitForURL(/\/admin\/agent\/runs\//);
  check((await page.locator("p.alert").textContent())?.includes("GITHUB_TOKEN"), "run button without a token says what is missing");
  await page.goto(BASE + "/admin/agent");
  await page.click("form[action='/admin/agent/start'] button[type=submit]");
  await page.waitForURL(/e=bad/);
  check(true, "run with nothing ticked is refused");

  // 2. Dry run by the agent itself.
  const dry = newRun("dry");
  const r1 = await runAgent(dry);
  check(r1.status === 0, `dry run exits cleanly${r1.status ? ": " + r1.stderr : ""}`);
  check(!fake.hits.some((h) => h.path?.startsWith("/Images/")), "dry run downloads nothing");
  check(fake.hits.every((h) => h.ua?.startsWith("ExamPrepLibraryAgent/1.0")), "agent names itself honestly");
  check(fake.hits[0]?.path === "/robots.txt", "robots.txt is read first");
  await page.goto(`${BASE}/admin/agent/runs/${dry}`);
  const would = await page.locator("details", { hasText: "Would fetch" }).locator("li").allTextContents();
  const want = ["0625_s24_qp_11.pdf", "0625_s24_ms_11.pdf", "0625_s24_er.pdf", "0625_y23_sp_1.pdf", "0625_s24_qp_21.pdf", "0625_s24_ms_21.pdf"];
  check(want.every((w) => would.includes(w)) && would.length === want.length, `dry run lists the right ${want.length} files`);
  check((await page.locator("details", { hasText: "Blocked by robots.txt" }).locator("li").allTextContents()).some((t) => t.includes("/blocked/")), "robots.txt block is reported");
  check((await page.locator("details", { hasText: "Links not recognised" }).locator("li").allTextContents()).some((t) => t.includes("syllabus-update")), "unknown links are reported");
  check((await page.locator("text=Download these 6 files").count()) === 1, "dry run offers to download");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "375px run report: no sideways scroll");

  // 3. Download run.
  const dl = newRun("download");
  const before = fake.hits.length;
  const r2 = await runAgent(dl);
  check(r2.status === 0, `download run exits cleanly${r2.status ? ": " + r2.stderr : ""}`);
  const gaps = fake.hits.slice(before).filter((h) => h.path?.startsWith("/Images/"));
  check(gaps.length === 6 && !fake.hits.some((h) => h.path?.includes("2019")), "only requested files are fetched");
  const stored = rows(`SELECT file_name, origin, source_site_id FROM source_document WHERE job_id = '${dl}' AND status = 'stored' ORDER BY file_name`);
  check(stored.map((s) => s.file_name).join(",") === "0625_s24_er.pdf,0625_s24_ms_11.pdf,0625_s24_qp_11.pdf,0625_y23_sp_1.pdf", "four real PDFs stored");
  check(stored.every((s) => s.origin === "agent" && s.source_site_id === "local-test"), "stored as agent files with their source");
  await page.goto(`${BASE}/admin/agent/runs/${dl}`);
  const notStored = await page.locator("details", { hasText: "Not stored" }).locator("li").allTextContents();
  check(notStored.some((t) => t.includes("0625_s24_qp_21.pdf") && t.includes("Not a PDF")), "fake PDF is refused");
  check(notStored.some((t) => t.includes("0625_s24_ms_21.pdf") && t.includes("http_404")), "missing file is reported");
  await page.goto(BASE + "/admin/library?year=2024");
  check((await page.locator(".list-row", { hasText: "0625_s24_qp_11.pdf" }).textContent())?.includes("Agent"), "library shows agent files");

  // 4. Re-running finds nothing new.
  const again = newRun("dry");
  await runAgent(again);
  const rep = JSON.parse(rows(`SELECT result FROM job WHERE id = '${again}'`)[0].result);
  check(rep.candidates.length === 2 && rep.skippedHave === 4, "a second run skips what is already stored");

  // 5. Settings page.
  await page.goto(BASE + "/admin/settings");
  await page.fill("input[name=fromYear]", "2030");
  await page.click("form[action='/admin/settings/save'] button");
  await page.waitForURL(/e=bad/);
  check((await page.locator("p.alert").count()) === 1, "settings: impossible years refused");
  await page.fill("input[name=fromYear]", "2022");
  await page.click("form[action='/admin/settings/save'] button");
  await page.waitForURL(/e=ok_saved/);
  check(true, "settings: saved");
  check(errors.length === 0, `no script or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();

  // 6. Attacks on the agent endpoints.
  const api = await apiRequest.newContext({ baseURL: BASE });
  const enc = new TextEncoder();
  const run3 = newRun("download");
  const jb = enc.encode(JSON.stringify({ jobId: run3 }));
  check((await api.post("/api/agent/job", { data: jb })).status() === 401, "unsigned agent request refused");
  const signed = await signRequest(SECRET, "POST", "/api/agent/job", jb);
  check((await api.post("/api/agent/job", { data: Buffer.from(jb), headers: { ...signed, "content-type": "application/json" } })).status() === 200, "signed agent request accepted");
  check((await api.post("/api/agent/job", { data: Buffer.from(jb), headers: { ...signed, "content-type": "application/json" } })).status() === 401, "replayed request refused");
  const wrong = await signRequest("w".repeat(40), "POST", "/api/agent/job", jb);
  check((await api.post("/api/agent/job", { data: Buffer.from(jb), headers: wrong })).status() === 401, "wrong secret refused");
  const old = await signRequest(SECRET, "POST", "/api/agent/job", jb, Date.now() - 10 * 60_000);
  check((await api.post("/api/agent/job", { data: Buffer.from(jb), headers: old })).status() === 401, "old timestamp refused");
  const pdf = enc.encode("%PDF-1.4\n%%EOF");
  const offsite = await signRequest(SECRET, "POST", "/api/agent/file", pdf);
  const res = await api.post("/api/agent/file", {
    data: Buffer.from(pdf),
    headers: { ...offsite, "x-agent-job": run3, "x-agent-file": "0625_s24_qp_12.pdf", "x-agent-site": "local-test", "x-agent-url": "https://evil.example/x.pdf" },
  });
  check(res.status() === 403, "file from outside the source address refused");
  await api.dispose();
} finally {
  await browser.close();
  fake.server.close();
  sql(`DELETE FROM source_page WHERE site_id = 'local-test'`);
  sql(`UPDATE source_document SET source_site_id = NULL WHERE source_site_id = 'local-test'`);
  sql(`DELETE FROM source_site WHERE id = 'local-test'`);
  sql(`UPDATE source_site SET enabled = 1 WHERE id = 'cambridge-official'`);
  sql(`UPDATE job SET status = 'failed' WHERE type = 'agent' AND status IN ('queued', 'running')`);
}
process.exit(failures ? 1 : 0);
