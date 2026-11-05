// Topic tree (Phase 2 step 1) against a running Worker (http://localhost:8787), with fake Claude and Gemini servers
// in this process: the real brain script runs end to end (signed calls, PDF fetch, both readers, word and number
// checks, the second try, saving) and the admin pages show the result. Never contacts a real AI. The syllabus text
// is written for the test (not Cambridge's wording). Admin is desktop only: tested at 1400 px.
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const BASE = "http://localhost:8787";
const vars = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8");
const PASS = vars.match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
const SECRET = vars.match(/^AGENT_SECRET=(.*)$/m)?.[1]?.trim();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const sql = (q) => {
  for (let i = 0; ; i++) {
    try {
      return execFileSync("npx", ["wrangler", "d1", "execute", "cambridge", "--local", "--json", "--command", q], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      if (i >= 2) throw e;
      execFileSync("sleep", ["1"]);
    }
  }
};
const rows = (q) => JSON.parse(sql(q))[0].results;

// ---------- A made-up syllabus as a real PDF ----------
const LINES = [
  ["Syllabus", "Cambridge IGCSE Physics 0625", "Use this syllabus for exams in 2023, 2024 and 2025."],
  [
    "3 Subject content",
    "1 Moving things",
    "1.1 Moving objects",
    "Core",
    "1 Describe how a trolley rolls down a ramp and",
    "explain why it speeds up",
    "2 Measure the time a pendulum takes for ten swings",
    "Supplement",
    "3 Calculate the average speed of a cyclist from a",
    "distance and a time",
    "1.2 Pushing and pulling",
    "Core",
    "1 State that a push or a pull is called a force",
  ],
  [
    "2 Warm things",
    "2.1 Heating water",
    "1 Describe what happens to water heated in a kettle",
    "Notes and guidance",
    "Use an electric kettle with a thermometer",
    // Padding so the text is long enough for the word check to run (a real syllabus has tens of pages).
    ...Array.from({ length: 100 }, (_, i) => `Background reading line ${i + 1} about scientific skills for planning a fair test with care`),
  ],
];
function pagesPdf(pages) {
  const enc = (s) => new TextEncoder().encode(s);
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const bodies = [];
  const add = (b) => (bodies.push(b), bodies.length);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contents = pages.map((lines) => {
    const ops = ["BT", "/F1 9 Tf", ...lines.map((l, i) => `1 0 0 1 40 ${800 - i * 11} Tm (${esc(l)}) Tj`), "ET"].join("\n");
    return add(`<< /Length ${enc(ops).length} >>\nstream\n${ops}\nendstream`);
  });
  const root = bodies.length + pages.length + 1;
  const ids = contents.map((c) => add(`<< /Type /Page /Parent ${root} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  add(`<< /Type /Pages /Kids [${ids.map((p) => `${p} 0 R`).join(" ")}] /Count ${ids.length} >>`);
  add(`<< /Type /Catalog /Pages ${root} 0 R >>`);
  return enc(`%PDF-1.7\n${bodies.map((b, i) => `${i + 1} 0 obj\n${b}\nendobj`).join("\n")}\ntrailer\n<< >>\n%%EOF\n`);
}

const GOOD = {
  topics: [
    { number: "1", title: "Moving things", parent: "" },
    { number: "1.1", title: "Moving objects", parent: "1" },
    { number: "1.2", title: "Pushing and pulling", parent: "1" },
    { number: "2", title: "Warm things", parent: "" },
    { number: "2.1", title: "Heating water", parent: "2" },
  ],
  goals: [
    { topic: "1.1", number: "1", text: "Describe how a trolley rolls down a ramp and explain why it speeds up", tier: "core", notes: "" },
    { topic: "1.1", number: "2", text: "Measure the time a pendulum takes for ten swings", tier: "core", notes: "" },
    { topic: "1.1", number: "3", text: "Calculate the average speed of a cyclist from a distance and a time", tier: "supplement", notes: "" },
    { topic: "1.2", number: "1", text: "State that a push or a pull is called a force", tier: "core", notes: "" },
    { topic: "2.1", number: "1", text: "Describe what happens to water heated in a kettle", tier: "core", notes: "Use an electric kettle with a thermometer" },
  ],
};
const copy = (d) => JSON.parse(JSON.stringify(d));

// ---------- Fake Claude (streamed Messages API) and Gemini (generateContent) ----------
const ai = { claude: [], gemini: [], claudeAnswers: [], geminiAnswer: GOOD };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};
    if (req.url.startsWith("/claude/v1/messages")) {
      ai.claude.push({ headers: req.headers, body: json });
      const answer = JSON.stringify(ai.claudeAnswers.shift() ?? GOOD);
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: json.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      for (let i = 0; i < answer.length; i += 400) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: answer.slice(i, i + 400) } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 300 } });
      ev("message_stop", {});
      res.end();
      return;
    }
    if (req.url.startsWith("/gemini/models/")) {
      ai.gemini.push({ url: req.url, headers: req.headers, body: json });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ai.geminiAnswer) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200 } }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const FAKE = `http://127.0.0.1:${server.address().port}`;

const runBrain = (jobId, extra = {}) =>
  new Promise((resolve) => {
    const child = spawn("node", ["scripts/brain/topics.ts"], {
      env: {
        ...process.env, APP_URL: BASE, AGENT_SECRET: SECRET, JOB_ID: jobId, BRAIN_TEST_MODE: "1",
        CLAUDE_API_KEY: "test-claude-key", GEMINI_API_KEY: "test-gemini-key",
        CLAUDE_BASE_URL: `${FAKE}/claude`, GEMINI_BASE_URL: `${FAKE}/gemini`, ...extra,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
const newRun = () => {
  const j = `e2eb${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  sql(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('${j}', 'brain', 'queued', '{"task":"topics","syllabusId":"0625-2023"}', 'platform-admin', ${Date.now()})`);
  sql(`INSERT INTO topic_tree (syllabus_id, job_id, updated_at) VALUES ('0625-2023', '${j}', ${Date.now()}) ON CONFLICT (syllabus_id) DO UPDATE SET job_id = '${j}'`);
  return j;
};

sql(`UPDATE job SET status = 'failed' WHERE type = 'brain' AND status IN ('queued', 'running')`);
sql(`DELETE FROM topic_tree WHERE syllabus_id = '0625-2023'`);
sql(`DELETE FROM source_document WHERE file_name = '0625_y23_sy.pdf'`);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": `203.0.113.${1 + Math.floor(Math.random() * 250)}` } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "/admin/login");
  await page.fill("#password", PASS);
  await page.click("form[action='/admin/session'] button");
  await page.waitForURL(BASE + "/admin");
  const noSideways = async () => !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));

  // 1. Without the syllabus PDF there is nothing to read.
  await page.goto(BASE + "/admin/library/0625");
  await page.click("text=Topic tree");
  await page.waitForURL(BASE + "/admin/library/0625/topics");
  const card = page.locator("#tree-2023");
  check((await card.textContent())?.includes("not in the library yet"), "no syllabus PDF: the page says so and links to the version page");
  check((await card.locator("button", { hasText: "Draft topic tree" }).count()) === 0, "no syllabus PDF: no draft button");

  // Store the made-up syllabus through the normal folder upload path.
  const pdf = [...pagesPdf(LINES)];
  const stored = await page.evaluate(async (bytes) => {
    const r = await fetch("/admin/library/folder/file", { method: "POST", headers: { "x-file-name": "0625_y23_sy.pdf", "Content-Type": "application/pdf" }, body: new Uint8Array(bytes) });
    return r.json();
  }, pdf);
  check(stored.ok === true, `syllabus PDF stored for the test${stored.ok ? "" : ": " + JSON.stringify(stored)}`);

  // 2. The button without a GitHub token: the run closes with a clear message, in place.
  await page.reload();
  await card.locator("button", { hasText: "Draft topic tree" }).click();
  const said = await card.locator(".action-note", { hasText: "GITHUB_TOKEN" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check(said, "draft button without a GitHub token says what is missing, in place");
  if (!said) console.log(await card.innerHTML());
  check(rows(`SELECT error_ref FROM job WHERE type = 'brain' ORDER BY created_at DESC LIMIT 1`)[0]?.error_ref === "not_set_up", "the run is closed as not set up");
  await page.reload();
  check((await card.locator(".alert").textContent())?.includes("not set up"), "after a reload the version says why the last run stopped");
  check((await card.textContent())?.includes("Not drafted"), "the version is still not drafted");

  // 3. A full run: both readers agree, every check passes, the tree is ready.
  const run1 = newRun();
  const r1 = await runBrain(run1);
  check(r1.status === 0, `run exits cleanly${r1.status ? ": " + r1.out.slice(-800) : ""}`);
  const c1 = ai.claude[0];
  const key = c1?.headers["x-api-key"] ?? String(c1?.headers.authorization ?? "").replace(/^Bearer /, "");
  check(key === "test-claude-key" && String(c1?.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01"), "Claude is called with its key and refusal fallback");
  check(c1?.body.fallbacks === "default", "Claude refusals fall back by Anthropic's default routing");
  check(c1?.body.messages[0].content[0].type === "document" && c1?.body.messages[0].content[0].source.media_type === "application/pdf", "Claude is given the syllabus PDF");
  check(c1?.body.output_config?.format?.type === "json_schema" && c1?.body.stream === true && c1?.body.thinking?.type === "adaptive", "Claude: structured output, streamed, adaptive thinking");
  const g1 = ai.gemini[0];
  check(g1?.headers["x-goog-api-key"] === "test-gemini-key" && !g1.url.includes("key="), "Gemini key goes in a header, never the address");
  check(g1?.body.contents[0].parts[0].inline_data?.mime_type === "application/pdf", "Gemini is given the same PDF");
  check(!r1.out.includes("test-claude-key") && !r1.out.includes("test-gemini-key"), "keys never appear in the log");
  const t1 = rows(`SELECT status, topics, goals FROM topic_tree WHERE syllabus_id = '0625-2023'`)[0];
  check(t1?.status === "ready" && t1.topics === 5 && t1.goals === 5, "tree saved as ready with 5 topics and 5 goals");

  await page.goto(BASE + "/admin/library/0625/topics");
  check((await card.locator(".pill").textContent()) === "Ready", "versions page shows Ready");
  check((await card.textContent())?.includes("5 topics, 5 learning goals"), "versions page shows the counts");
  await card.locator("text=Open the tree").click();
  await page.waitForURL(BASE + "/admin/library/0625/topics/2023");
  check((await page.locator(".tree-section").allTextContents()).map((t) => t.trim()).join("|") === "1 Moving things|2 Warm things", "tree shows the two sections in order");
  check((await page.locator("#topic-1\\.1 .tree-goal").count()) === 3, "topic 1.1 shows its three goals");
  check((await page.locator("#topic-1\\.1 .tag-extended").textContent()) === "Supplement", "Supplement goals are marked");
  check((await page.locator(".tree-notes").textContent())?.includes("electric kettle"), "notes show under their goal");
  check((await page.locator("text=every title, goal and note was found").count()) === 1, "checks list says the word check passed");
  check((await page.locator("text=agrees on 100%").count()) === 1, "checks list shows Gemini's agreement");
  check(await noSideways(), "tree page: no sideways scroll at 1400 px");

  // 4. Claude invents a goal on the first try; the word check catches it and the second try fixes it.
  ai.claude.length = 0;
  const invented = copy(GOOD);
  invented.goals[1].text = "Measure the time a pendulum takes and work out the strength of gravity from it";
  ai.claudeAnswers.push(invented, GOOD);
  const run2 = newRun();
  const r2 = await runBrain(run2);
  check(r2.status === 0 && ai.claude.length === 2, "a failed check gives Claude a second try");
  const retry = ai.claude[1]?.body.messages[0].content[1].text ?? "";
  check(retry.includes("1.1 goal 2") && retry.includes("found in the syllabus"), "the second try is told what the check found");
  const rep2 = JSON.parse(rows(`SELECT report FROM topic_tree WHERE syllabus_id = '0625-2023'`)[0].report);
  check(rep2.attempts === 2 && rep2.problems.length === 0, "after the second try every check passes");

  // 5. Still wrong after two tries, and Gemini disagrees on a tier: stored, but not ready, with the reasons shown.
  const wrong = copy(GOOD);
  wrong.topics.push({ number: "1.3", title: "Floating and sinking", parent: "1" });
  wrong.goals.push({ topic: "1.3", number: "1", text: "Explain why a steel ship floats on water", tier: "core", notes: "" });
  ai.claudeAnswers.push(wrong, wrong);
  const g = copy(GOOD);
  g.goals[2].tier = "core";
  ai.geminiAnswer = g;
  const run3 = newRun();
  const r3 = await runBrain(run3);
  check(r3.status === 0, "a run that cannot pass still finishes");
  check(rows(`SELECT status FROM topic_tree WHERE syllabus_id = '0625-2023'`)[0].status === "not_ready", "a tree with open checks is stored as not ready");
  await page.goto(BASE + "/admin/library/0625/topics/2023");
  check((await page.locator(".pill").first().textContent()) === "Not ready", "tree page says Not ready");
  await page.locator("summary", { hasText: "still open" }).click();
  check((await page.locator("details", { hasText: "still open" }).textContent())?.includes("Floating and sinking"), "open checks name the invented topic");
  await page.locator("summary", { hasText: "between Claude and Gemini" }).click();
  check((await page.locator("details", { hasText: "between Claude and Gemini" }).textContent())?.includes("1.1 goal 3"), "the tier difference is listed");
  check((await page.locator(".tree-goal-flag").count()) >= 2, "goals with open checks are highlighted in the tree");
  check(await noSideways(), "not ready tree page: no sideways scroll");
  ai.geminiAnswer = GOOD;

  // 6. A missing key stops the run with a plain reason on the page.
  const run4 = newRun();
  const r4 = await runBrain(run4, { GEMINI_API_KEY: "" });
  check(r4.status === 1, "a missing key stops the script");
  check(rows(`SELECT error_ref FROM job WHERE id = '${run4}'`)[0].error_ref === "gemini_key", "the run records why");
  await page.goto(BASE + "/admin/library/0625/topics");
  check((await card.locator(".alert").textContent())?.includes("GEMINI_API_KEY"), "the page says which secret to check");
  check((await card.locator(".pill").textContent()) === "Not ready", "the stored tree stays as it was");

  // 7. Signed endpoints refuse unsigned calls.
  const unsigned = await fetch(`${BASE}/api/brain/job`, { method: "POST", body: "{}" });
  check(unsigned.status === 401, "brain endpoints refuse unsigned requests");

  check(errors.length === 0, `no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
  server.close();
  sql(`UPDATE job SET status = 'failed' WHERE type = 'brain' AND status IN ('queued', 'running')`);
  sql(`DELETE FROM topic_tree WHERE syllabus_id = '0625-2023'`);
  sql(`DELETE FROM source_document WHERE file_name = '0625_y23_sy.pdf'`);
}

console.log(failures ? `\n${failures} failed` : "\nall brain checks passed");
process.exit(failures ? 1 : 0);
