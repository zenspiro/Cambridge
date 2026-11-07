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
// A made-up question paper (step 2b): a cover long enough for the word check, and two pages of questions.
const PAPER_LINES = [
  ["Cambridge IGCSE PHYSICS 0625/42", "Paper 4 Theory (Extended) May/June 2024", "The total mark for this paper is 5.",
    ...Array.from({ length: 30 }, (_, i) => `Instruction line ${i + 1}: answer all questions in the spaces provided with a dark pen`)],
  // A ramp drawn above its printed label "Fig. 1.1" (cut by its label, no flag).
  { lines: ["1 (a) State the instrument used to measure the time taken by a trolley", "rolling down a ramp. [1]",
    "(b) The trolley takes 2.5 s to travel 1.5 m. Calculate its average speed. [2]", "Fig. 1.1 shows the ramp."],
    draw: "1 w 150 600 m 400 700 l 400 600 l h S", at: [[410, 650, "ramp"], [260, 570, "Fig. 1.1"]] },
  ["BLANK PAGE", "\u00a9 UCLES 2024 0625/42/M/J/24"],
  // A block drawn with no label (cut by position: flagged blue, its box can be drawn by hand).
  { lines: ["2 (a) Define the term density and state its unit. [2]"], draw: "1 w 200 500 120 80 re S", at: [[330, 540, "2 cm"]] },
];
const PAPER_GOOD = {
  totalMarks: 5,
  items: [
    { number: "1(a)", page: 2, text: "State the instrument used to measure the time taken by a trolley rolling down a ramp.", marks: 1, options: [], answerLines: 1, figures: ["F1"], guidance: "" },
    { number: "1(b)", page: 2, text: "The trolley takes 2.5 s to travel 1.5 m. Calculate its average speed.", marks: 2, options: [], answerLines: 2, figures: [], guidance: "" },
    // Page 3 of the PDF the AIs get: the blank page 3 is left out, so this is the paper's page 4.
    { number: "2(a)", page: 3, text: "Define the term density and state its unit.", marks: 2, options: [], answerLines: 2, figures: ["F2"], guidance: "" },
  ],
  figures: [
    { id: "F1", page: 2, caption: "Fig. 1.1 the ramp", description: "A ramp labelled ramp." },
    { id: "F2", page: 3, caption: "a block", description: "A rectangular block with a side of 2 cm." },
  ],
};
const pdfPages = (b64) => (Buffer.from(String(b64 ?? ""), "base64").toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
// Claude misreads 1(b): the word check and Gemini both catch it.
const PAPER_CLAUDE = { ...PAPER_GOOD, items: PAPER_GOOD.items.map((i) => (i.number === "1(b)" ? { ...i, text: "The trolley takes 2.5 s to travel 1.5 m. Calculate its mean speed." } : i)) };

function pagesPdf(pages) {
  const enc = (s) => new TextEncoder().encode(s);
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const bodies = [];
  const add = (b) => (bodies.push(b), bodies.length);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contents = pages.map((pg) => {
    // A page is its lines, or { lines, draw (PDF path operators), at: [[x, y, text]] (labels placed on the page) }.
    const { lines, draw = "", at = [] } = Array.isArray(pg) ? { lines: pg } : pg;
    const ops = [draw, "BT", "/F1 9 Tf", ...lines.map((l, i) => `1 0 0 1 40 ${800 - i * 11} Tm (${esc(l)}) Tj`), ...at.map(([x, y, t]) => `1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj`), "ET"].filter(Boolean).join("\n");
    return add(`<< /Length ${enc(ops).length} >>\nstream\n${ops}\nendstream`);
  });
  const root = bodies.length + pages.length + 1;
  const ids = contents.map((c) => add(`<< /Type /Page /Parent ${root} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  add(`<< /Type /Pages /Kids [${ids.map((p) => `${p} 0 R`).join(" ")}] /Count ${ids.length} >>`);
  add(`<< /Type /Catalog /Pages ${root} 0 R >>`);
  // A real cross-reference table and trailer, so other PDF tools (Poppler, which cuts the figures) can open it.
  let out = "%PDF-1.7\n";
  const offsets = bodies.map((b, i) => {
    const at = enc(out).length;
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
    return at;
  });
  const xref = enc(out).length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${bodies.length + 1} /Root ${bodies.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
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
const ai = { claude: [], gemini: [], claudeAnswers: [], geminiAnswer: GOOD, busyOnce: false, down503: 0, claudeFailOnce: false, seq: [] };
const isPaper = (system) => /exam paper/.test(String(system ?? ""));
const isDrawing = (system) => /redraw figures/.test(String(system ?? ""));
const DRAWN = { figures: [] };
// Models the fake Google lists for the key; tiny questions to gemini-2.5-pro come back "not on your plan".
const LISTED = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-embedding-001"];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};
    if (req.method === "GET" && req.url.startsWith("/claude/v1/models")) {
      // Anthropic's model list for the key (AI setup: Check Claude).
      ai.claude.push({ headers: req.headers, body: null, url: req.url });
      const data = ["claude-sonnet-5-5", "claude-opus-5-5"].map((id) => ({ type: "model", id, display_name: id.replace(/-/g, " "), created_at: "2026-10-01T00:00:00Z" }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data, has_more: false, first_id: data[0].id, last_id: data[1].id }));
      return;
    }
    if (req.url.startsWith("/claude/v1/messages")) {
      ai.claude.push({ headers: req.headers, body: json });
      if (!json.stream) {
        // The AI setup check's one tiny question (not streamed).
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "msg_check", type: "message", role: "assistant", model: json.model, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }));
        return;
      }
      if (ai.claudeFailOnce) {
        ai.claudeFailOnce = false;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "Internal server error" } }));
        return;
      }
      ai.seq.push(isDrawing(json.system) ? "claude-draw" : isPaper(json.system) ? "claude-paper" : "claude");
      const doc = (json.messages?.[0]?.content ?? []).find((c) => c.type === "document");
      ai.claudePages = { ...(ai.claudePages ?? {}), [ai.seq.at(-1)]: pdfPages(doc?.source?.data) };
      if (ai.seq.at(-1) === "claude-paper") {
        ai.claudeText = (json.messages?.[0]?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
        ai.claudeEffort = json.output_config?.effort;
      }
      const answer = JSON.stringify(isDrawing(json.system) ? DRAWN : isPaper(json.system) ? PAPER_CLAUDE : ai.claudeAnswers.shift() ?? GOOD);
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
    if (req.method === "GET" && req.url.startsWith("/gemini/models?")) {
      ai.gemini.push({ url: req.url, headers: req.headers, body: null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: LISTED.map((n) => ({ name: `models/${n}`, displayName: n.replace(/-/g, " "), supportedGenerationMethods: n.includes("embedding") ? ["embedContent"] : ["generateContent"] })) }));
      return;
    }
    if (req.url.startsWith("/gemini/models/")) {
      ai.gemini.push({ url: req.url, headers: req.headers, body: json });
      if (req.url.startsWith("/gemini/models/gemini-2.5-pro:")) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro" } }));
        return;
      }
      if (ai.down503 > 0) {
        ai.down503--;
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }));
        return;
      }
      if (ai.busyOnce) {
        ai.busyOnce = false;
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 10", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] } }));
        return;
      }
      const paper = isPaper(json.systemInstruction?.parts?.[0]?.text);
      if (json.systemInstruction) ai.seq.push(paper ? "gemini-paper" : "gemini");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(paper ? PAPER_GOOD : ai.geminiAnswer) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200 } }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const FAKE = `http://127.0.0.1:${server.address().port}`;

const runBrain = (jobId, extra = {}) =>
  new Promise((resolve) => {
    const child = spawn("node", ["scripts/brain/run.ts"], {
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
  await page.locator(".row-actions a", { hasText: "Topic tree" }).click();
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

  // 7. Gemini busy for a moment (free per-minute limit): the run waits as Google says and carries on.
  ai.busyOnce = true;
  const runBusy = newRun();
  const rb = await runBrain(runBusy);
  check(rb.status === 0 && rb.out.includes("Gemini is busy"), "a busy Gemini is waited for, not a failed run");

  // 7b. Gemini overloaded (503) for a moment: tried again after a wait, and the run carries on.
  ai.down503 = 1;
  const runBlip = newRun();
  const rbl = await runBrain(runBlip);
  check(rbl.status === 0 && rbl.out.includes("Gemini is having trouble (503)"), "an overloaded Gemini is tried again, not a failed run");

  // 7c. Gemini stays down: the run stops before Claude is asked anything, so it costs nothing.
  ai.down503 = 10;
  ai.claude.length = 0;
  const runDown = newRun();
  const rd = await runBrain(runDown);
  check(rd.status === 1 && rows(`SELECT error_ref FROM job WHERE id = '${runDown}'`)[0].error_ref === "gemini_down", "Gemini down after its retries stops the run with its own reason");
  check(ai.claude.length === 0, "Claude is never asked when Gemini is down (Gemini reads first)");
  ai.down503 = 0;
  await page.goto(BASE + "/admin/library/0625/topics");
  check((await card.locator(".alert").textContent())?.includes("Nothing was charged for Claude"), "the page says Claude was not charged");

  // 7d. Claude fails after Gemini finished: Gemini's reading is kept, and the next run reuses it.
  ai.claudeFailOnce = true;
  const runFail = newRun();
  const rf = await runBrain(runFail);
  check(rf.status === 1, "a Claude failure stops the run");
  ai.gemini.length = 0;
  const runAgain = newRun();
  const ra = await runBrain(runAgain);
  check(ra.status === 0 && ra.out.includes("gemini: reusing the reading kept"), "the next run reuses Gemini's kept reading");
  check(!ai.gemini.some((x) => x.url.includes(":generateContent")), "Gemini is not asked again for a kept reading");
  ai.gemini.length = 0;
  const runFresh = newRun();
  await runBrain(runFresh);
  check(ai.gemini.some((x) => x.url.includes(":generateContent")), "after a saved tree, the next run reads afresh");

  // 8. The topic trees overview in the sidebar.
  await page.goto(BASE + "/admin/topics");
  check((await page.locator(".side-link[aria-current=page]").textContent()) === "Topic trees", "sidebar marks Topic trees");
  check((await page.locator("a[href='/admin/library/0625/topics/2023']").textContent())?.includes("5 topics"), "overview links Physics's drafted tree with its size");
  check((await page.locator("tr", { hasText: "IGCSE Chemistry (0620)" }).first().textContent())?.includes("Not drafted"), "overview shows subjects not drafted yet");
  check(await noSideways(), "topic trees overview: no sideways scroll");

  // 9. The review screen: a green tick opens the PDF beside what we hold.
  await page.goto(BASE + "/admin/library/0625/version/2023");
  await page.locator('a.cell-have[title^="0625_y23_sy.pdf:"]').click();
  await page.waitForURL(/\/admin\/library\/review\//);
  const reviewUrl = page.url();
  check((await page.locator("h1").textContent())?.includes("syllabus"), "review screen names the file in words");
  const frame = page.locator("iframe.review-pdf");
  const src = await frame.getAttribute("src");
  check(Boolean(src?.endsWith("/view")), "the PDF is shown in the page");
  const view = await page.request.get(BASE + src);
  check(view.status() === 200 && view.headers()["content-type"] === "application/pdf" && view.headers()["content-disposition"]?.startsWith("inline"), "the PDF is served inline");
  check(view.headers()["x-frame-options"] === "SAMEORIGIN" && view.headers()["content-security-policy"]?.includes("frame-ancestors 'self'"), "only our own pages may frame the PDF");
  const reviewHead = await page.request.get(reviewUrl);
  check(reviewHead.headers()["content-security-policy"]?.includes("frame-src 'self'"), "the review page may frame our own PDF");
  const libHead = await page.request.get(BASE + "/admin/library");
  check(libHead.headers()["content-security-policy"]?.includes("frame-src 'none'"), "other pages still frame nothing");
  const dl = await page.request.get(BASE + "/admin/library/file/" + src.split("/")[4]);
  check(dl.headers()["content-disposition"]?.startsWith("attachment") && dl.headers()["x-frame-options"] === "DENY", "Download stays an attachment that cannot be framed");
  check((await page.locator(".facts").textContent())?.includes("0625_y23_sy.pdf"), "what we hold: the file's details");
  check((await page.locator("text=topic tree").count()) >= 1, "a syllabus links to its topic tree");
  check(await noSideways(), "review screen: no sideways scroll at 1400 px");
  const halves = await page.evaluate(() => [...document.querySelectorAll(".review-pane")].map((e) => Math.round(e.getBoundingClientRect().width)));
  check(halves.length === 2 && Math.abs(halves[0] - halves[1]) < 4, "the PDF and what we hold each take half");

  // 10. AI setup: each AI has its own check and a dropdown of models; the usage dashboard, prices and the cap.
  await page.goto(BASE + "/admin/ai");
  check((await page.locator("#ai-gemini").textContent())?.includes("gemini-3.5-flash"), "AI setup shows the Gemini model in use");
  check((await page.locator("#ai-claude").textContent())?.includes("claude-sonnet-5-5"), "Claude Sonnet 5.5 is the default main AI");
  await page.locator("#ai-gemini button", { hasText: "Check Gemini" }).click();
  await page.locator("#ai-gemini .action-note", { hasText: "GITHUB_TOKEN" }).waitFor({ timeout: 10_000 }).then(() => check(true, "check without a GitHub token says what is missing"), () => check(false, "check without a GitHub token says what is missing"));
  const gemRun = `e2eg${Date.now()}`;
  sql(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('${gemRun}', 'brain', 'queued', '{"task":"check","which":"gemini"}', 'platform-admin', ${Date.now()})`);
  ai.claude.length = 0;
  const rg = await runBrain(gemRun);
  check(rg.status === 0, `Gemini check exits cleanly${rg.status ? ": " + rg.out.slice(-600) : ""}`);
  check(ai.gemini.some((g) => g.url.startsWith("/gemini/models?") && g.headers["x-goog-api-key"] === "test-gemini-key"), "the check asks Google for the key's models, key in a header");
  check(ai.claude.length === 0, "Check Gemini does not ask Claude anything");
  const claudeRun = `e2ek${Date.now()}`;
  sql(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('${claudeRun}', 'brain', 'queued', '{"task":"check","which":"claude"}', 'platform-admin', ${Date.now()})`);
  ai.gemini.length = 0;
  const rk = await runBrain(claudeRun);
  check(rk.status === 0, `Claude check exits cleanly${rk.status ? ": " + rk.out.slice(-600) : ""}`);
  check(ai.claude.some((c) => c.url?.startsWith("/claude/v1/models")), "Check Claude asks Anthropic for the key's models");
  check(ai.gemini.length === 0, "Check Claude does not ask Gemini anything");
  await page.goto(BASE + "/admin/ai");
  const row = (n) => page.locator(`#model-${n.replace(/\./g, "\\.")}`);
  check((await row("gemini-3.5-flash").textContent())?.includes("Works"), "the Gemini list survives a Claude check");
  check((await row("gemini-2.5-pro").textContent())?.includes("Not on your plan"), "a model the free plan lacks says so");
  check((await page.locator("#ai-claude").textContent())?.includes("Works"), "Claude is tried");
  check((await page.locator("#model-gemini-embedding-001").count()) === 0, "models that cannot write text are not listed");
  const gemOptions = await page.locator("#ai-gemini select option").evaluateAll((o) => o.map((x) => x.value));
  check(gemOptions.includes("gemini-3.1-flash-lite") && !gemOptions.includes("gemini-2.5-pro"), "the Gemini dropdown offers only working models");
  check((await page.locator("#ai-claude select option").count()) === 2, "the Claude dropdown offers the key's Claude models");
  check((await page.locator("#ai-drawing").textContent())?.includes("(the same as the main AI)"), "the drawing AI follows the main AI until chosen");
  await page.locator("#ai-drawing select").selectOption("claude-opus-5-5");
  await page.locator("#ai-drawing button", { hasText: "Use this model" }).click();
  await page.locator("#ai-drawing", { hasText: "(chosen here)" }).waitFor({ timeout: 15_000 }).then(() => check(true, "a drawing model is chosen on its own"), () => check(false, "a drawing model is chosen on its own"));
  check((await page.locator("#ai-claude").textContent())?.includes("claude-sonnet-5-5"), "choosing the drawing model leaves the main AI alone");
  await page.locator("#ai-gemini select").selectOption("gemini-3.1-flash-lite");
  await page.locator("#ai-gemini button", { hasText: "Use this model" }).click();
  // In place (ActionForm), or as a plain form if clicked before the page's scripts loaded: either way it says Saved.
  await page.locator(".action-note, .notice", { hasText: "Saved" }).first().waitFor({ timeout: 15_000 });
  await page.locator("#ai-gemini", { hasText: "gemini-3.1-flash-lite" }).waitFor({ timeout: 10_000 }).then(() => check(true, "a working model is chosen in place"), () => check(false, "a working model is chosen in place"));
  await page.locator("#ai-claude select").selectOption("claude-opus-5-5");
  await page.locator("#ai-claude button", { hasText: "Use this model" }).click();
  await page.locator("#ai-claude", { hasText: "claude-opus-5-5 (chosen here)" }).waitFor({ timeout: 15_000 }).then(() => check(true, "a Claude model is chosen from the dropdown"), () => check(false, "a Claude model is chosen from the dropdown"));
  ai.gemini.length = 0;
  ai.claude.length = 0;
  const runChosen = newRun();
  await runBrain(runChosen);
  check(ai.gemini.some((g) => g.url.startsWith("/gemini/models/gemini-3.1-flash-lite:")), "runs use the chosen Gemini model");
  check(ai.claude.some((c) => c.body?.model === "claude-opus-5-5"), "runs use the chosen Claude model");

  // Usage: every question is recorded with its tokens and shown per model and job.
  const spent = rows(`SELECT provider, model, SUM(input_tokens) AS tin FROM ai_spend WHERE job_id = '${runChosen}' GROUP BY provider, model`);
  check(spent.some((r) => r.provider === "claude" && r.model === "claude-opus-5-5" && r.tin > 0) && spent.some((r) => r.provider === "gemini" && r.tin > 0), "a run records each AI's tokens");
  await page.goto(BASE + "/admin/ai");
  const usage = (await page.locator("#usage").textContent()) ?? "";
  check(usage.includes("claude-opus-5-5") && usage.includes("Topic trees") && usage.includes("AI setup checks"), "the dashboard shows usage per model and per job");
  check((await page.locator("#usage .alert").textContent())?.includes("gemini-3.1-flash-lite"), "a model without a price is named, not guessed");
  await page.locator("#price-gemini-3\\.1-flash-lite input[name=in]").fill("0");
  await page.locator("#price-gemini-3\\.1-flash-lite input[name=out]").fill("0");
  await page.locator("#price-gemini-3\\.1-flash-lite button").click();
  await page.locator("#price-gemini-3\\.1-flash-lite .action-note", { hasText: "Price saved" }).waitFor({ timeout: 15_000 }).then(() => check(true, "a price is saved in place"), () => check(false, "a price is saved in place"));

  // The cap: the topic tree page shows the rough cost and refuses a run that would go past it.
  await page.locator("#cap input[name=cap]").fill("0.000001");
  await page.locator("#cap button").click();
  await page.locator("#cap .action-note", { hasText: "cap saved" }).waitFor({ timeout: 15_000 });
  await page.goto(BASE + "/admin/library/0625/topics");
  check((await card.locator(".cost-line").textContent())?.includes("will not start"), "past the cap, the topic tree page says the run will not start");
  const refused = await page.evaluate(async (id) => {
    const r = await fetch("/admin/library/0625/topics/draft", { method: "POST", body: new URLSearchParams({ syllabus: id }) });
    return new URL(r.url).searchParams.get("e");
  }, "0625-2023");
  check(refused === "over_cap", `a run past the cap does not start (${refused})`);
  sql(`DELETE FROM setting WHERE key = 'ai_budget'`);
  await page.reload();
  check((await card.locator(".cost-line").textContent())?.includes("Rough cost: about"), "without a cap the rough cost is shown");
  sql(`DELETE FROM setting WHERE key IN ('ai_models', 'ai_check')`);
  await page.goto(BASE + "/admin/ai");
  check(await noSideways(), "AI setup: no sideways scroll");

  // 12. Reading a paper (step 2b): Read this paper, live progress, the paper rebuilt beside the PDF, flags and fixes.
  sql(`DELETE FROM source_document WHERE file_name = '0625_s24_qp_42.pdf'`);
  const paperPdf = [...pagesPdf(PAPER_LINES)];
  const storedPaper = await page.evaluate(async (bytes) => {
    const r = await fetch("/admin/library/folder/file", { method: "POST", headers: { "x-file-name": "0625_s24_qp_42.pdf", "Content-Type": "application/pdf" }, body: new Uint8Array(bytes) });
    return r.json();
  }, paperPdf);
  check(storedPaper.ok === true, `test question paper stored${storedPaper.ok ? "" : ": " + JSON.stringify(storedPaper)}`);
  const paperId = rows(`SELECT id FROM source_document WHERE file_name = '0625_s24_qp_42.pdf'`)[0]?.id;
  await page.goto(`${BASE}/admin/library/0625/2024/june`);
  const reviewLink = page.locator(`#to-review a[href="/admin/library/review/${paperId}"]`);
  check((await reviewLink.count()) === 1 && (await page.locator("#to-review").textContent())?.includes("Paper 4, variant 2: question paper") && (await page.locator("#to-review").textContent())?.includes("Not read"), "the session page lists the paper with a Review button and Not read");
  await page.goto(`${BASE}/admin/library/review/${paperId}`);
  check((await page.locator("#reading .pill").textContent()) === "Not read", "a paper not read yet says so");
  check((await page.locator("#reading").textContent())?.includes("Rough cost"), "Read this paper shows the rough cost first");
  await page.locator("#reading button", { hasText: "Read this paper" }).click();
  await page.locator("#reading .action-note", { hasText: "GITHUB_TOKEN" }).waitFor({ timeout: 10_000 }).then(() => check(true, "Read this paper without a GitHub token says what is missing"), () => check(false, "Read this paper without a GitHub token says what is missing"));

  // A queued run shows the live progress panel (no page reloads).
  const queued = `e2eq${Date.now()}`;
  sql(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('${queued}', 'brain', 'queued', '{"task":"paper","docId":"${paperId}","scope":{"items":[],"figures":[]}}', 'platform-admin', ${Date.now()})`);
  sql(`UPDATE paper_read SET job_id = '${queued}' WHERE doc_id = '${paperId}'`);
  await page.reload();
  await page.locator("#run-progress", { hasText: "Waiting for GitHub" }).waitFor({ timeout: 10_000 }).then(() => check(true, "a waiting run shows the live progress panel"), () => check(false, "a waiting run shows the live progress panel"));
  check((await page.locator("#run-progress .run-step").count()) === 6, "the panel lists each step: PDF, Gemini, Claude, figures, checks, saving");
  check((await page.locator("meta[http-equiv=refresh]").count()) === 0, "no page reloads while it runs");
  ai.seq.length = 0;
  const rp = await runBrain(queued);
  check(rp.status === 0, `the paper run exits cleanly${rp.status ? ": " + rp.out.slice(-800) : ""}`);
  const order = ai.seq.filter((x) => x !== "claude");
  check(order.join(",") === "gemini-paper,claude-paper", `Gemini reads first, then Claude; no drawing AI (${order.join(",")})`);
  check(ai.claudePages["claude-paper"] === 1, `Claude gets only the page with a figure as a picture (${ai.claudePages["claude-paper"]} of 4 pages)`);
  check(ai.claudeText.includes("=== Page 4 ===") && ai.claudeText.includes("=== Page 1 ===") && !ai.claudeText.includes("=== Page 3 ==="), "the other pages go as text, without the blank page");
  check(ai.claudeEffort === "low", `Claude reads papers at low effort (${ai.claudeEffort})`);
  check(rp.out.includes("Cut 2 of 2 figures"), `both figures are cut from the PDF${rp.out.includes("Cut ") ? "" : ": " + rp.out.slice(-600)}`);
  check(rp.out.includes("Leaving out 1 blank page (3)"), "the run says which blank pages it left out");
  await page.locator("#run-progress", { hasText: "Finished" }).waitFor({ timeout: 15_000 }).then(() => check(true, "the panel shows the run finished, in place"), () => check(false, "the panel shows the run finished, in place"));
  const st = await (await page.request.get(`${BASE}/admin/brain/runs/${queued}`)).json();
  const notDone = ["gemini", "claude", "figures", "checks"].filter((s) => !st.events.some((e) => e.stage === s && e.state === "done"));
  check(!notDone.length, `each step reported done, with its model and tokens${notDone.length ? ` (not: ${notDone.join(", ")}; ${st.events.map((e) => `${e.stage}:${e.state}`).join(" ")})` : ""}`);
  check(st.events.some((e) => e.stage === "claude" && e.model === "claude-sonnet-5-5" && e.tokens > 0), "Claude's step shows its model and tokens");
  check(rows(`SELECT COUNT(*) AS n FROM ai_spend WHERE job_id = '${queued}' AND task = 'drawing'`)[0].n === 0, "no drawing AI is paid for");
  await page.locator("#run-progress .run-step-done[data-stage=\"save\"]").waitFor({ timeout: 15_000 }).then(() => check(true, "the saving step shows done once the run has finished"), () => check(false, "the saving step shows done once the run has finished"));

  await page.goto(`${BASE}/admin/library/review/${paperId}`);
  await page.locator("#paper-sheet").waitFor({ timeout: 10_000 });
  const pill = await page.locator("#reading .pill").textContent();
  check(/flag/.test(pill ?? ""), `the misread is flagged (${pill})`);
  check((await page.locator("#item-1\\(a\\)").textContent())?.includes("State the instrument"), "the paper is rebuilt from our reading, page by page");
  check((await page.locator("#item-1\\(a\\) .pq-marks").textContent()) === "[1]", "marks show as on the paper");
  check((await page.locator("#item-1\\(b\\).pq-red").count()) === 1, "the misread part is boxed in red");
  // The panel asks the server for its state after the page loads, so wait for its answer (CI is slower than local).
  await page.locator("#run-progress", { hasText: "Finished" }).waitFor({ timeout: 15_000 }).then(() => check(true, "the finished run's steps stay on the page for a while"), () => check(false, "the finished run's steps stay on the page for a while"));
  check((await page.locator("#item-1\\(b\\) .flag-pdf").first().textContent())?.includes("Calculate its average speed"), "the flag shows the PDF's own words");
  const img = page.locator("#figure-F1 img");
  check((await img.count()) === 1 && (await page.locator("#figure-F1.pq-blue").count()) === 0, "the figure cut above its printed label shows, with no flag");
  check((await page.locator("#figure-F1").textContent())?.includes("Cut from the PDF above its label"), "it says how it was cut");
  const svg = await page.request.get(BASE + (await img.getAttribute("src")));
  const svgText = await svg.text();
  check(svg.headers()["content-type"] === "image/svg+xml" && svgText.startsWith("<svg") && !/script|onclick|xlink/.test(svgText) && svgText.includes("<use href=\"#g"), "the figure is the PDF's own drawing as a clean SVG (letters as outlines)");
  check(rows(`SELECT COUNT(*) AS n FROM paper_read WHERE doc_id = '${paperId}'`)[0].n === 1, "the reading is saved");
  check((await page.locator("iframe.review-pdf").getAttribute("src"))?.endsWith("#page=2"), "the PDF opens on the first page with questions");
  await page.locator(".page-bar button", { hasText: "Next page" }).click();
  check((await page.locator("iframe.review-pdf").getAttribute("src"))?.endsWith("#page=3") && (await page.locator("#paper-sheet").textContent())?.includes("Nothing from our reading on this page"), "one page bar turns both sides (the blank page has nothing)");
  await page.locator(".page-bar button", { hasText: "Next page" }).click();
  check((await page.locator("iframe.review-pdf").getAttribute("src"))?.endsWith("#page=4") && (await page.locator("#item-2\\(a\\)").count()) === 1, "page numbers are the paper's own, even with the blank page left out for the AIs");
  await page.locator(".page-bar button", { hasText: "Next flag" }).click();
  check((await page.locator(".page-bar-count").textContent()) === "Page 2 of 4", "Next flag jumps to the flagged page");
  check(/^Flag 1 of \d+$/.test((await page.locator(".flag-count").textContent()) ?? ""), "the bar says which flag of how many");
  const listed = await page.locator(".flag-list .flag-row").count();
  check(listed >= 2 && (await page.locator(".flag-list .flag-row-current").count()) === 1, `the flag list shows every open flag, the chosen one marked (${listed})`);
  await page.locator(".flag-filter", { hasText: "Figures" }).click();
  check((await page.locator(".flag-list .flag-row").count()) === 1 && (await page.locator(".flag-row-item").first().textContent()) === "F2", "the colour filter shows only the figure flag");
  await page.locator(".flag-list .flag-row").first().click();
  check((await page.locator(".page-bar-count").textContent()) === "Page 4 of 4" && (await page.locator("#figure-F2 .flag-current").count()) === 1, "a click on a flag jumps to its page and marks it");
  await page.locator(".flag-filter", { hasText: "All" }).click();
  await page.keyboard.press("j");
  check((await page.locator(".page-bar-count").textContent()) === "Page 2 of 4", "J moves to the next flag (round to the first)");
  await page.reload();
  await page.locator("#paper-sheet").waitFor({ timeout: 10_000 });
  await page.locator(".flag-row-current").waitFor({ timeout: 5_000 }).catch(() => {});
  check((await page.locator(".page-bar-count").textContent()) === "Page 2 of 4" && (await page.locator(".flag-row-current").count()) === 1, "after a reload the page and flag you were on come back");
  const flagsBefore = await page.locator("#paper-sheet .flag-box").count();
  await page.locator(".check-inline input").uncheck();
  check((await page.locator("#paper-sheet .flag-box").count()) === 0, "Show flags off hides them");
  await page.locator(".check-inline input").check();
  check((await page.locator("#paper-sheet .flag-box").count()) === flagsBefore, "and on shows them again");

  await page.locator('#item-1\\(b\\) .flag-box[data-flag="words:1(b)"] button', { hasText: "Use the PDF's version" }).click();
  // The fixed flag was the chosen one: once its flags clear, the next open flag (the figure on page 4) is picked.
  await page.locator(".page-bar-count", { hasText: "Page 4 of 4" }).waitFor({ timeout: 15_000 }).then(() => check(true, "after a fix the next open flag is picked"), () => check(false, "after a fix the next open flag is picked"));
  await page.locator(".page-bar button", { hasText: "Previous page" }).click();
  await page.locator(".page-bar button", { hasText: "Previous page" }).click();
  await page.locator("#item-1\\(b\\) .pq-text", { hasText: "Calculate its average speed" }).waitFor({ timeout: 15_000 }).then(() => check(true, "Use the PDF's version copies the PDF's words, in place"), () => check(false, "Use the PDF's version copies the PDF's words, in place"));
  check((await page.locator("#item-1\\(b\\).pq-red").count()) === 0, "the wording and Gemini flags clear once it matches the PDF");
  check((await page.locator("#figure-F2.pq-blue").count()) === 1, "the figure cut without a label is boxed in blue");
  await page.locator("#figure-F2 button", { hasText: "Looks right" }).click();
  await page.locator("#reading .pill", { hasText: "Ready" }).waitFor({ timeout: 15_000 }).then(() => check(true, "every flag cleared: the paper is Ready"), () => check(false, "every flag cleared: the paper is Ready"));
  await page.locator("#reading summary", { hasText: "Fixes on this paper" }).click();
  await page.locator("#reading .fix-list li", { hasText: "Looks right" }).locator("button", { hasText: "Undo" }).click();
  await page.locator("#reading .pill", { hasText: "1 flag open" }).waitFor({ timeout: 15_000 }).then(() => check(true, "Undo brings a flag back"), () => check(false, "Undo brings a flag back"));
  await page.locator("#reading button", { hasText: "Mark ready anyway" }).click();
  await page.locator("#reading button", { hasText: "Yes" }).click();
  await page.locator("#reading .pill", { hasText: "Ready (marked ready)" }).waitFor({ timeout: 15_000 }).then(() => check(true, "the admin can mark it ready with flags left (recorded)"), () => check(false, "the admin can mark it ready with flags left (recorded)"));
  check(rows(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'paper.override'`)[0].n >= 1, "the override is audited");

  // A figure's box drawn by hand on its page.
  await page.locator(".flag-filter", { hasText: "Figures" }).click();
  await page.locator(".flag-list .flag-row").first().click();
  await page.locator("#figure-F2 .flag-box button", { hasText: "Adjust box" }).click();
  const sheet = page.locator("#figure-F2 .box-editor-page");
  await sheet.waitFor({ timeout: 10_000 });
  const bb = (await sheet.boundingBox());
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.45, { steps: 5 });
  await page.mouse.up();
  await page.locator("#figure-F2 button", { hasText: "Save this box" }).click();
  await page.locator("#figure-F2", { hasText: "Box drawn by hand" }).waitFor({ timeout: 15_000 }).then(() => check(true, "a box drawn by hand is saved, in place"), () => check(false, "a box drawn by hand is saved, in place"));
  check((await page.locator("#figure-F2.pq-blue").count()) === 0, "and the figure's flag clears");
  const box = JSON.parse(rows(`SELECT after FROM paper_fix WHERE doc_id = '${paperId}' AND item = 'F2' ORDER BY at DESC LIMIT 1`)[0]?.after ?? "{}").box ?? [];
  check(box.length === 4 && box[0] > 150 && box[2] < 450 && box[1] > 200 && box[3] < 450, `the box is in the PDF's own points (${box.join(", ")})`);
  check(await noSideways(), "review screen with the rebuilt paper: no sideways scroll at 1400 px");
  const halves2 = await page.evaluate(() => [...document.querySelectorAll(".review-pane")].map((e) => Math.round(e.getBoundingClientRect().width)));
  check(halves2.length === 2 && Math.abs(halves2[0] - halves2[1]) < 4, "the PDF and the rebuilt paper each take half");

  // 11. Signed endpoints refuse unsigned calls.
  const unsigned = await fetch(`${BASE}/api/brain/job`, { method: "POST", body: "{}" });
  check(unsigned.status === 401, "brain endpoints refuse unsigned requests");
  check((await fetch(`${BASE}/api/brain/check`, { method: "POST", body: "{}" })).status === 401, "the check endpoint refuses unsigned requests");
  check((await fetch(`${BASE}/api/brain/usage`, { method: "POST", body: "{}" })).status === 401, "the usage endpoint refuses unsigned requests");
  check((await fetch(`${BASE}/api/brain/paper`, { method: "POST", body: "{}" })).status === 401, "the paper endpoint refuses unsigned requests");
  check((await fetch(`${BASE}/api/brain/figpage`, { method: "POST", body: "{}" })).status === 401, "the figure page endpoint refuses unsigned requests");
  const anon = await fetch(`${BASE}/admin/brain/runs/${queued}`, { redirect: "manual" });
  check(anon.status !== 200 && !(anon.headers.get("content-type") ?? "").includes("json"), "run state needs the admin");
  check((await fetch(`${BASE}/api/brain/reading`, { method: "POST", body: "{}" })).status === 401 && (await fetch(`${BASE}/api/brain/saved`, { method: "POST", body: "{}" })).status === 401, "the kept-reading endpoints refuse unsigned requests");

  check(errors.length === 0, `no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} finally {
  await browser.close();
  server.close();
  sql(`UPDATE job SET status = 'failed' WHERE type = 'brain' AND status IN ('queued', 'running')`);
  sql(`DELETE FROM topic_tree WHERE syllabus_id = '0625-2023'`);
  sql(`DELETE FROM source_document WHERE file_name IN ('0625_y23_sy.pdf', '0625_s24_qp_42.pdf')`);
  sql(`DELETE FROM setting WHERE key IN ('ai_models', 'ai_check', 'ai_budget')`);
}

console.log(failures ? `\n${failures} failed` : "\nall brain checks passed");
process.exit(failures ? 1 : 0);
