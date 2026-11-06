// The subject brain, step 1: the topic tree. Runs in GitHub Actions (.github/workflows/brain.yml):
//   node scripts/brain/run.ts   (task "topics": a topic tree; task "check": the AI setup check)
// Reads its run from the Worker, fetches the syllabus PDF, asks Claude to copy the subject content into topics and
// goals and Gemini (another provider) to do the same on its own, checks Claude's copy word for word against the PDF's
// text and its numbering, compares the two, gives Claude one more try with what the checks found, and sends the tree
// and the report back. Owner decision 5 Nov 2026: no human review; code and a second AI decide.
// Needs: APP_URL, AGENT_SECRET, JOB_ID, CLAUDE_API_KEY, GEMINI_API_KEY. Keys are never logged or sent to our site.
import Anthropic from "@anthropic-ai/sdk";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import { signRequest } from "../../src/lib/agent/sign.ts";
import { allPagesText } from "../../src/lib/pdf/firstPage.ts";
import { retryPrompt, TOPIC_SCHEMA, TOPIC_SCHEMA_GEMINI, TOPIC_SYSTEM, topicPrompt } from "../../src/lib/brain/prompts.ts";
import {
  checkNumbers, checkWords, cleanDraft, compareDrafts, isReady, missingHeadings, retryNotes, textIndex,
  type Draft, type Problem, type TextIndex, type TreeReport,
} from "../../src/lib/brain/topics.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { geminiStatus, modelsToTry, retryDelayMs, type ModelStatus, type ModelTry } from "../../src/lib/brain/aiSetup.ts";

type Limits = {
  attempts: number; claudeMaxTokens: number; claudeEffort: "low" | "medium" | "high" | "xhigh" | "max"; geminiMaxTokens: number; maxPdfBytes: number;
  geminiTries: number; geminiMaxWaitMs: number; checkModels: number; checkDelayMs: number;
};
type Job =
  | { task: "topics"; subject: string; pdfBytes: number; models: { claude: string; gemini: string }; limits: Limits }
  | { task: "check"; which: "claude" | "gemini" | null; models: { claude: string; gemini: string }; limits: Limits };
type TopicJob = Extract<Job, { task: "topics" }>;

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.AGENT_SECRET ?? "";
const JOB_ID = process.env.JOB_ID ?? "";
const CLAUDE_KEY = process.env.CLAUDE_API_KEY ?? "";
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? "";
const RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null;
// Local tests only (APP_URL on this machine): fake Claude and Gemini servers stand in for the real ones.
const TEST_MODE = process.env.BRAIN_TEST_MODE === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL);
const GEMINI_API = (TEST_MODE && process.env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com/v1beta";
const CLAUDE_BASE = TEST_MODE ? process.env.CLAUDE_BASE_URL : undefined;

const enc = new TextEncoder();
const log = (msg: string) => console.log(`[brain] ${msg}`);

/** A known failure with a fixed reason code for the run page. */
class Stop extends Error {
  reason: string;
  constructor(reason: string, detail = "") {
    super(detail || reason);
    this.reason = reason;
  }
}

async function api(path: string, payload: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null; bytes?: Uint8Array }> {
  const body = enc.encode(JSON.stringify({ jobId: JOB_ID, ...payload }));
  const headers = { ...(await signRequest(SECRET, "POST", path, body)), "Content-Type": "application/json" };
  const res = await fetch(APP_URL + path, { method: "POST", headers, body: body as BodyInit, signal: AbortSignal.timeout(120_000) });
  if ((res.headers.get("content-type") ?? "").startsWith("application/pdf")) return { status: res.status, data: null, bytes: new Uint8Array(await res.arrayBuffer()) };
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, data: null };
  }
}

/** Tells the admin page what is happening. A 409 means the run was closed: stop. */
async function step(text: string) {
  log(text);
  const r = await api("/api/brain/step", { step: text });
  if (r.status === 409) throw new Stop("closed");
}

/**
 * Tells our site the tokens one question used (AI usage dashboard and monthly cap). Best effort: a failure here is
 * logged and the run carries on.
 */
async function usage(provider: "claude" | "gemini", model: string, tokensIn: number, tokensOut: number, pages = 0) {
  try {
    const r = await api("/api/brain/usage", { usage: { provider, model, calls: 1, pages, tokensIn, tokensOut } });
    if (r.status !== 200) log(`usage not recorded (${r.status})`);
  } catch {
    log("usage not recorded (no answer)");
  }
}

/** The plain message of a Claude error (the JSON body's message, not the raw text). */
function claudeMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: unknown } } | undefined;
    if (typeof body?.error?.message === "string") return body.error.message.slice(0, 300);
  }
  return err instanceof Error ? err.message.slice(0, 300) : "";
}

// ---------- The two readers ----------

type Reading = { raw: unknown; tokensIn: number; tokensOut: number };

async function askClaude(client: Anthropic, job: TopicJob, pdf64: string, prompt: string, pages: number): Promise<Reading> {
  // Streamed (long answer); refusals fall back to another model on Anthropic's side ("default" routing).
  const stream = client.beta.messages.stream({
    model: job.models.claude,
    max_tokens: job.limits.claudeMaxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: job.limits.claudeEffort, format: { type: "json_schema", schema: TOPIC_SCHEMA } },
    system: TOPIC_SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf64 } },
        { type: "text", text: prompt },
      ],
    }],
  });
  const msg = await stream.finalMessage();
  // The model that answered (a fallback may have served it); counted even when the answer is refused or cut off.
  await usage("claude", msg.model || job.models.claude, msg.usage.input_tokens, msg.usage.output_tokens, pages);
  if (msg.stop_reason === "refusal") throw new Stop("claude_refused");
  if (msg.stop_reason === "max_tokens") throw new Stop("claude_too_long");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Stop("claude_bad_answer");
  }
  return { raw, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Gemini request. A busy answer (429: free per-minute or per-day limits) waits as long as Google suggests and
 * tries again, up to `limits.geminiTries`; a model the plan does not include stops at once.
 */
async function geminiCall(model: string, body: unknown, limits: Limits, timeoutMs: number): Promise<{ status: number; text: string }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 429 || geminiStatus(429, text) === "not_on_plan" || attempt >= limits.geminiTries) return { status: res.status, text };
    const wait = Math.min(retryDelayMs(text), limits.geminiMaxWaitMs);
    log(`Gemini is busy (limit reached); waiting ${Math.round(wait / 1000)} s, then try ${attempt + 1}`);
    await sleep(wait);
  }
}

async function askGemini(job: TopicJob, pdf64: string, pages: number): Promise<Reading> {
  const r = await geminiCall(job.models.gemini, {
    systemInstruction: { parts: [{ text: TOPIC_SYSTEM }] },
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdf64 } }, { text: topicPrompt(job.subject) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: TOPIC_SCHEMA_GEMINI, maxOutputTokens: job.limits.geminiMaxTokens },
  }, job.limits, 20 * 60_000);
  const st = geminiStatus(r.status, r.text);
  if (st === "not_found") throw new Stop("gemini_model", `model "${job.models.gemini}" not found. Available: ${await geminiModels()}`);
  if (st === "refused") throw new Stop("gemini_key", `Gemini refused (${r.status}): ${r.text.slice(0, 300)}`);
  if (st === "not_on_plan") throw new Stop("gemini_plan", `model "${job.models.gemini}" is not on this key's plan`);
  if (st === "busy") throw new Stop("gemini_busy", "Gemini's limit was still reached after waiting");
  if (st !== "ok") throw new Stop("gemini_error", `Gemini error ${r.status}`);
  const data = JSON.parse(r.text) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const u = data.usageMetadata ?? {};
  const tokensIn = u.promptTokenCount ?? 0;
  const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  await usage("gemini", job.models.gemini, tokensIn, tokensOut, pages);
  const c = data.candidates?.[0];
  if (c?.finishReason === "MAX_TOKENS") throw new Stop("gemini_too_long");
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Stop("gemini_bad_answer");
  }
  return { raw, tokensIn, tokensOut };
}

/** The Gemini models this key may use for text (name and Google's display name). */
async function listGemini(): Promise<{ status: number; models: { name: string; label: string }[]; text: string }> {
  const res = await fetch(`${GEMINI_API}/models?pageSize=200`, { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) return { status: res.status, models: [], text };
  const d = JSON.parse(text) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  const models = (d.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({ name: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }));
  return { status: res.status, models, text };
}

/** The model names Gemini offers, for the run log when the configured one is not found. */
async function geminiModels(): Promise<string> {
  try {
    return (await listGemini()).models.map((m) => m.name).join(", ") || "(none listed)";
  } catch {
    return "(could not list)";
  }
}

// ---------- AI setup check ----------

/**
 * "Check Claude" lists the Claude models the key may use and tries the one in use once; "Check Gemini" lists the
 * Gemini models the key may use for text and tries the one in use and up to `checkModels` more. `which` null: both.
 */
async function runCheck(job: Extract<Job, { task: "check" }>) {
  const result: CheckResult = {
    claude: { model: job.models.claude, status: "untested", detail: "" },
    gemini: { model: job.models.gemini, status: "untested", detail: "" },
    models: [],
    claudeModels: [],
  };
  if (job.which !== "gemini") await checkClaude(job, result);
  if (job.which !== "claude") await checkGemini(job, result);
  const r = await api("/api/brain/check", { result });
  if (r.status !== 200) throw new Stop(`save_${r.status}`);
  log(`check saved: Claude ${result.claude.status}, Gemini ${result.gemini.status}, ${result.models.filter((m) => m.status === "ok").length} Gemini models work`);
}

type CheckResult = { claude: { model: string; status: ModelStatus; detail: string }; gemini: { model: string; status: ModelStatus; detail: string }; models: ModelTry[]; claudeModels: ModelTry[] };

async function checkClaude(job: Extract<Job, { task: "check" }>, result: CheckResult) {
  await step("Asking Anthropic which Claude models your key can use");
  if (!CLAUDE_KEY) {
    result.claude = { model: job.models.claude, status: "refused", detail: "The GitHub secret CLAUDE_API_KEY is not set." };
    return;
  }
  const client = new Anthropic({ apiKey: CLAUDE_KEY, maxRetries: 1, timeout: 120_000, ...(CLAUDE_BASE ? { baseURL: CLAUDE_BASE } : {}) });
  try {
    for await (const m of client.models.list({ limit: 100 })) {
      if (/^claude-[a-z0-9][a-z0-9.-]{0,60}$/.test(m.id)) result.claudeModels.push({ name: m.id, label: m.display_name || m.id, status: "untested", detail: "" });
      if (result.claudeModels.length >= 60) break;
    }
  } catch (err) {
    log(`could not list Claude models: ${claudeMessage(err)}`);
  }
  await step("Trying Claude");
  try {
    const msg = await client.messages.create({ model: job.models.claude, max_tokens: 64, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the word OK." }] });
    await usage("claude", msg.model || job.models.claude, msg.usage.input_tokens, msg.usage.output_tokens);
    result.claude.status = "ok";
  } catch (err) {
    const msg = claudeMessage(err);
    const st: ModelStatus = err instanceof Anthropic.AuthenticationError ? "refused" : err instanceof Anthropic.NotFoundError ? "not_found"
      : err instanceof Anthropic.RateLimitError ? "busy" : /credit balance/i.test(msg) ? "no_credit" : "error";
    result.claude = { model: job.models.claude, status: st, detail: msg };
  }
  const inUse = result.claudeModels.find((m) => m.name === job.models.claude);
  if (inUse) {
    inUse.status = result.claude.status;
    inUse.detail = result.claude.detail;
  }
}

async function checkGemini(job: Extract<Job, { task: "check" }>, result: CheckResult) {
  await step("Asking Google which Gemini models your key can use");
  if (!GEMINI_KEY) {
    result.gemini = { model: job.models.gemini, status: "refused", detail: "The GitHub secret GEMINI_API_KEY is not set." };
    return;
  }
  const listed = await listGemini();
  if (listed.status !== 200) {
    result.gemini = { model: job.models.gemini, status: geminiStatus(listed.status, listed.text), detail: listed.text.slice(0, 300) };
    return;
  }
  const tries = modelsToTry(listed.models.map((m) => m.name), job.models.gemini);
  const label = new Map(listed.models.map((m) => [m.name, m.label]));
  const untested: ModelTry[] = [];
  for (const m of listed.models) if (!tries.includes(m.name) && /^gemini-/.test(m.name)) untested.push({ name: m.name, label: m.label, status: "untested", detail: "" });
  const tried: ModelTry[] = [];
  for (const [i, name] of tries.entries()) {
    await step(`Trying Gemini model ${i + 1} of ${tries.length}`);
    // One try each: a busy model is reported as busy, not waited for.
    const r = await geminiCall(name, { contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }], generationConfig: { maxOutputTokens: 32 } }, { ...job.limits, geminiTries: 1 }, 60_000);
    const st = geminiStatus(r.status, r.text);
    if (st === "ok") {
      try {
        const u = (JSON.parse(r.text) as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } }).usageMetadata ?? {};
        await usage("gemini", name, u.promptTokenCount ?? 0, (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0));
      } catch {
        // an answer without usage figures is still a working model
      }
    }
    tried.push({ name, label: label.get(name) ?? name, status: st, detail: st === "ok" ? "" : r.text.replace(/\s+/g, " ").slice(0, 300) });
    if (i < tries.length - 1) await sleep(job.limits.checkDelayMs);
  }
  result.models = [...tried, ...untested];
  const inUse = tried.find((t) => t.name === job.models.gemini);
  result.gemini = inUse
    ? { model: job.models.gemini, status: inUse.status, detail: inUse.detail }
    : { model: job.models.gemini, status: "not_found", detail: "This model is not in the list your key can use." };
}

// ---------- One run ----------

function checksFor(draft: Draft, idx: TextIndex | null, pages: string[], shape: Problem[]): Problem[] {
  return [...shape, ...(idx ? checkWords(draft, idx) : []), ...checkNumbers(draft), ...missingHeadings(draft, pages)];
}

async function main() {
  if (!/^https?:\/\/[^/]+$/.test(APP_URL) || !/^[A-Za-z0-9_-]{10,64}$/.test(JOB_ID) || SECRET.length < 32) {
    console.error("brain: APP_URL, JOB_ID and AGENT_SECRET (32+ characters) are required");
    process.exit(2);
  }
  const jr = await api("/api/brain/job", { runUrl: RUN_URL });
  if (jr.status !== 200 || !jr.data) throw new Stop(jr.data?.error === "no_syllabus" ? "no_syllabus" : "no_run");
  const job = jr.data as unknown as Job;
  if (job.task === "check") return runCheck(job);
  if (!CLAUDE_KEY) throw new Stop("claude_key", "the GitHub secret CLAUDE_API_KEY is not set");
  if (!GEMINI_KEY) throw new Stop("gemini_key", "the GitHub secret GEMINI_API_KEY is not set");
  if (!job.models.claude || !job.models.gemini) throw new Stop("models", "no Claude or Gemini model is set (AI setup page or wrangler.jsonc)");
  if (job.pdfBytes > job.limits.maxPdfBytes) throw new Stop("pdf_too_big");

  await step("Fetching the syllabus PDF");
  const doc = await api("/api/brain/doc", {});
  if (!doc.bytes?.length) throw new Stop("no_syllabus");
  const pdf64 = Buffer.from(doc.bytes).toString("base64");
  const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
  const pages = await allPagesText(doc.bytes, inflate);
  const idx = textIndex(pages);
  const textChecked = idx.chars >= BRAIN.minTextChars;
  log(`syllabus: ${pages.length} pages, ${idx.chars} letters and digits; word check ${textChecked ? "on" : "off (text unreadable)"}`);

  const client = new Anthropic({ apiKey: CLAUDE_KEY, maxRetries: TEST_MODE ? 0 : 3, timeout: 30 * 60_000, ...(CLAUDE_BASE ? { baseURL: CLAUDE_BASE } : {}) });
  const usage = { claudeIn: 0, claudeOut: 0, geminiIn: 0, geminiOut: 0 };

  await step("Claude and Gemini are each reading the syllabus");
  const [first, gem] = await Promise.all([askClaude(client, job, pdf64, topicPrompt(job.subject), pages.length), askGemini(job, pdf64, pages.length)]);
  usage.claudeIn += first.tokensIn;
  usage.claudeOut += first.tokensOut;
  usage.geminiIn += gem.tokensIn;
  usage.geminiOut += gem.tokensOut;
  const gemini = cleanDraft(gem.raw).draft;

  let current = cleanDraft(first.raw);
  let attempts = 1;
  let problems = checksFor(current.draft, textChecked ? idx : null, pages, current.problems);
  let cmp = compareDrafts(current.draft, gemini, textChecked ? idx : null);
  log(`try 1: ${current.draft.topics.length} topics, ${current.draft.goals.length} goals, ${problems.length} problems, agreement ${(cmp.agreement * 100).toFixed(1)}%`);

  while (attempts < job.limits.attempts && !isReady({ textChecked, problems, agreement: cmp.agreement }) && (problems.length || cmp.disagreements.length)) {
    attempts++;
    await step(`Claude is checking ${problems.length + cmp.disagreements.length} points again (try ${attempts})`);
    const next = await askClaude(client, job, pdf64, retryPrompt(job.subject, retryNotes(problems, cmp.disagreements)), pages.length);
    usage.claudeIn += next.tokensIn;
    usage.claudeOut += next.tokensOut;
    current = cleanDraft(next.raw);
    problems = checksFor(current.draft, textChecked ? idx : null, pages, current.problems);
    cmp = compareDrafts(current.draft, gemini, textChecked ? idx : null);
    log(`try ${attempts}: ${current.draft.topics.length} topics, ${current.draft.goals.length} goals, ${problems.length} problems, agreement ${(cmp.agreement * 100).toFixed(1)}%`);
  }

  const report: TreeReport = {
    attempts,
    textChecked,
    problems: problems.slice(0, BRAIN.maxReportItems),
    agreement: cmp.agreement,
    disagreements: cmp.disagreements.slice(0, BRAIN.maxReportItems),
    settled: cmp.settled,
    models: job.models,
    usage,
  };
  await step("Saving the topic tree");
  const fin = await api("/api/brain/finish", { draft: current.draft, report });
  if (fin.status !== 200) throw new Stop(`save_${fin.status}`);
  log(`saved: ${String(fin.data?.result)}; Claude ${usage.claudeIn} in / ${usage.claudeOut} out, Gemini ${usage.geminiIn} in / ${usage.geminiOut} out`);
}

main().catch(async (err: unknown) => {
  const reason = err instanceof Stop ? err.reason : err instanceof Anthropic.AuthenticationError ? "claude_key"
    : err instanceof Anthropic.NotFoundError ? "claude_model" : err instanceof Anthropic.APIError ? "claude_error" : "script_error";
  // Only the message, never request details (which would not hold keys anyway, but keep logs plain).
  console.error(`[brain] stopped: ${reason}: ${err instanceof Error ? err.message.slice(0, 500) : ""}`);
  if (reason !== "closed" && reason !== "no_run") {
    try {
      await api("/api/brain/fail", { reason });
    } catch {
      // the run page closes it after BRAIN.staleAfterMs
    }
  }
  process.exit(1);
});
