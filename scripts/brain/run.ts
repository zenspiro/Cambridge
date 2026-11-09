// The subject brain. Runs in GitHub Actions (.github/workflows/brain.yml):
//   node scripts/brain/run.ts   (task "topics": a topic tree; "paper": read a question paper or mark scheme;
//                                "check": the AI setup check)
// Reads its run from the Worker, fetches the syllabus PDF, asks Claude to copy the subject content into topics and
// goals and Gemini (another provider) to do the same on its own, checks Claude's copy word for word against the PDF's
// text and its numbering, compares the two, gives Claude one more try with what the checks found, and sends the tree
// and the report back. Owner decision 5 Nov 2026: no human review; code and a second AI decide.
// Needs: APP_URL, AGENT_SECRET, JOB_ID, CLAUDE_API_KEY, GEMINI_API_KEY. Keys are never logged or sent to our site.
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignBoxes, findBoxes, labelBoxes, pageArt, textLines, type Box, type FigureCut } from "../../src/lib/brain/figures.ts";
import { signRequest } from "../../src/lib/agent/sign.ts";
import { allPagesInfo, allPagesText } from "../../src/lib/pdf/firstPage.ts";
import { fractionBars, notatedPages, pdfOutline, type Bar, type OutlinePart } from "../../src/lib/brain/notation.ts";
import {
  PAPER_SCHEMA, PAPER_SCHEMA_GEMINI, PAPER_SYSTEM, paperPrompt,
  retryPrompt, TOPIC_SCHEMA, TOPIC_SCHEMA_GEMINI, TOPIC_SYSTEM, topicPrompt,
} from "../../src/lib/brain/prompts.ts";
import { blankPages, cleanPaper, figuresToLeads, keptPages, mergeReading, paperFlags, picturePages, placeOnPages, remapPages, textPagesBlock, type PaperContent, type PaperKind } from "../../src/lib/brain/paper.ts";
import {
  checkNumbers, checkWords, cleanDraft, compareDrafts, isReady, missingHeadings, retryNotes, textIndex,
  type Draft, type Problem, type TextIndex, type TreeReport,
} from "../../src/lib/brain/topics.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { geminiStatus, hasServerFallback, modelsToTry, retryDelayMs, type ModelStatus, type ModelTry } from "../../src/lib/brain/aiSetup.ts";

type Limits = {
  attempts: number; claudeMaxTokens: number; claudeEffort: "low" | "medium" | "high" | "xhigh" | "max"; geminiMaxTokens: number; maxPdfBytes: number;
  geminiTries: number; geminiMaxWaitMs: number; checkModels: number; checkDelayMs: number; geminiRetryWaitsMs: number[];
  paperEffort?: "low" | "medium" | "high" | "xhigh" | "max"; drawEffort?: "low" | "medium" | "high" | "xhigh" | "max";
};
type Job =
  | { task: "topics"; subject: string; pdfBytes: number; models: { claude: string; gemini: string; drawing?: string }; limits: Limits }
  | { task: "check"; which: "claude" | "gemini" | null; models: { claude: string; gemini: string }; limits: Limits };
type TopicJob = Extract<Job, { task: "topics" }>;
type PaperJob = {
  task: "paper"; kind: PaperKind; subject: string; paper: string; pdfBytes: number;
  scope: { items: string[]; figures: string[] }; prior: { content: unknown; gemini?: unknown; open: string[] };
  /** reading: the Claude model that reads papers (AI setup's Reading AI, else the main AI's; older sites send none). */
  models: { claude: string; gemini: string; drawing: string; reading?: string }; limits: Limits;
  /** Read all (owner, 8 Nov 2026): this paper's place in the batch. */
  batch?: { at: number; of: number; label: string };
  /** "Read with" (owner, 9 Nov 2026): "gemini" reads with Gemini alone, no Claude and no second reader. */
  readWith?: "claude" | "gemini";
  /** Run the checks again (owner, 9 Nov 2026): no AI; today's checks on the stored reading, figures with no box cut. */
  check?: boolean;
};
type Stage = "pdf" | "gemini" | "claude" | "retry" | "figures" | "checks" | "save";
type StepEvent = { stage: Stage; state: "start" | "wait" | "done" | "fail" | "skip"; model?: string; tokens?: number };

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

/** Tells the admin page what is happening (and the live panel, with an event). A 409 means the run was closed: stop. */
async function step(text: string, event?: StepEvent) {
  log(text);
  const r = await api("/api/brain/step", { step: text, ...(event ? { event: { ...event, text } } : {}) });
  if (r.status === 409) throw new Stop("closed");
}

/** A progress note that must never stop the run (sent while an AI is writing). */
async function note(text: string, event: StepEvent) {
  log(text);
  try {
    await api("/api/brain/step", { step: text, event: { ...event, text } });
  } catch {
    // the next step will report
  }
}

/**
 * Tells our site the tokens one question used (AI usage dashboard and monthly cap). Best effort: a failure here is
 * logged and the run carries on.
 */
async function usage(provider: "claude" | "gemini", model: string, tokensIn: number, tokensOut: number, pages = 0, task?: "drawing") {
  try {
    const r = await api("/api/brain/usage", { usage: { provider, model, calls: 1, pages, tokensIn, tokensOut }, ...(task ? { task } : {}) });
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

type ClaudeAsk = {
  model: string; system: string; schema: unknown; prompt: string; pdf64: string; pages: number; limits: Limits;
  /** Thinking effort for this question (else the limits' Claude effort); extra text sent before the prompt. */
  effort?: Limits["claudeEffort"]; extraText?: string;
  /** The live panel's row and words ("Claude is reading the paper"). */
  stage: Stage; label: string; task?: "drawing";
};

/**
 * One streamed Claude question with the PDF attached and a JSON answer. While it writes, the live panel hears how much
 * it has written every 15 seconds. Refusals fall back to another model on Anthropic's side ("default" routing), except
 * for models that cannot (Haiku: a refusal there stops the run).
 */
async function askClaude(client: Anthropic, a: ClaudeAsk): Promise<Reading> {
  const stream = client.beta.messages.stream({
    model: a.model,
    max_tokens: a.limits.claudeMaxTokens,
    ...(hasServerFallback(a.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    thinking: { type: "adaptive" },
    output_config: { effort: a.effort ?? a.limits.claudeEffort, format: { type: "json_schema", schema: a.schema as Record<string, unknown> } },
    system: a.system,
    messages: [{
      role: "user",
      content: [
        ...(a.pdf64 ? [{ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.pdf64 } }] : []),
        ...(a.extraText ? [{ type: "text" as const, text: a.extraText }] : []),
        { type: "text" as const, text: a.prompt },
      ],
    }],
  });
  let written = 0;
  stream.on("text", (t: string) => {
    written += t.length;
  });
  const timer = setInterval(() => {
    if (written) void note(`${a.label}: written about ${Math.round(written / 6).toLocaleString("en-GB")} words so far`, { stage: a.stage, state: "start", model: a.model, tokens: Math.round(written / 4) });
  }, 15_000);
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (err) {
    // Cut off partway (network, overload): count what was read and written so far, so the dashboard matches the bill.
    const part = stream.currentMessage;
    if (part?.usage) await usage("claude", part.model || a.model, part.usage.input_tokens ?? 0, part.usage.output_tokens ?? 0, a.pages, a.task);
    throw err;
  } finally {
    clearInterval(timer);
  }
  // The model that answered (a fallback may have served it); counted even when the answer is refused or cut off.
  await usage("claude", msg.model || a.model, msg.usage.input_tokens, msg.usage.output_tokens, a.pages, a.task);
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

/** Google's temporary failures (overloaded, server error, gateway), worth trying again after a wait. */
const TEMPORARY = new Set([500, 502, 503, 504]);

/**
 * One Gemini request. A busy answer (429: free per-minute or per-day limits) waits as long as Google suggests and
 * tries again, up to `limits.geminiTries`; a model the plan does not include stops at once. A temporary failure
 * (503 overloaded, 500, 502, 504, or no answer at all) waits `limits.geminiRetryWaitsMs` in turn and tries again
 * (owner, 7 Nov 2026: a 503 had stopped a run).
 */
async function geminiCall(model: string, body: unknown, limits: Limits, timeoutMs: number): Promise<{ status: number; text: string }> {
  let busy = 1;
  let temporary = 0;
  const waits = (limits.geminiRetryWaitsMs ?? []).map((w) => (TEST_MODE ? Math.min(w, 1_000) : w));
  for (;;) {
    let status = 0;
    let text = "";
    try {
      const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(body),
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      text = err instanceof Error ? err.message : "no answer";
    }
    if (status === 0 || TEMPORARY.has(status)) {
      if (temporary >= waits.length) return { status: status || 503, text };
      const wait = waits[temporary++]!;
      log(`Gemini is having trouble (${status || "no answer"}); waiting ${Math.round(wait / 1000)} s, then trying again`);
      await sleep(wait);
      continue;
    }
    if (status !== 429 || geminiStatus(429, text) === "not_on_plan" || busy >= limits.geminiTries) return { status, text };
    const wait = Math.min(retryDelayMs(text), limits.geminiMaxWaitMs);
    log(`Gemini is busy (limit reached); waiting ${Math.round(wait / 1000)} s, then try ${busy + 1}`);
    busy++;
    await sleep(wait);
  }
}

type GeminiAsk = { model: string; system: string; schema: unknown; prompt: string; pdf64: string; pages: number; limits: Limits };

/** One Gemini question with the PDF attached and a JSON answer (temporary failures and busy limits are waited out). */
async function askGemini(g: GeminiAsk): Promise<Reading> {
  const r = await geminiCall(g.model, {
    systemInstruction: { parts: [{ text: g.system }] },
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: g.pdf64 } }, { text: g.prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: g.schema, maxOutputTokens: g.limits.geminiMaxTokens },
  }, g.limits, 20 * 60_000);
  const st = geminiStatus(r.status, r.text);
  if (st === "not_found") throw new Stop("gemini_model", `model "${g.model}" not found. Available: ${await geminiModels()}`);
  if (st === "refused") throw new Stop("gemini_key", `Gemini refused (${r.status}): ${r.text.slice(0, 300)}`);
  if (st === "not_on_plan") throw new Stop("gemini_plan", `model "${g.model}" is not on this key's plan`);
  if (st === "busy") throw new Stop("gemini_busy", "Gemini's limit was still reached after waiting");
  if (st !== "ok") throw new Stop(TEMPORARY.has(r.status) ? "gemini_down" : "gemini_error", `Gemini error ${r.status}`);
  const data = JSON.parse(r.text) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const u = data.usageMetadata ?? {};
  const tokensIn = u.promptTokenCount ?? 0;
  const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  await usage("gemini", g.model, tokensIn, tokensOut, g.pages);
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

/**
 * One AI's first reading: the kept one when an earlier run of this PDF and model left it, else asked for and kept
 * at once (so a later failure in this run does not throw it away).
 */
async function reading(provider: "claude" | "gemini", model: string, words: string, ask: () => Promise<Reading>): Promise<Reading> {
  const saved = await api("/api/brain/saved", { provider, model });
  if (saved.status === 200 && saved.data?.found === true && saved.data.raw) {
    log(`${provider}: reusing the reading kept from an earlier run (no new cost)`);
    await note(`${provider === "claude" ? "Claude" : "Gemini"}: reused the reading kept from an earlier run (no new cost)`, { stage: provider, state: "skip", model });
    return { raw: saved.data.raw, tokensIn: 0, tokensOut: 0 };
  }
  const r = await timed(provider, model, words, ask);
  const kept = await api("/api/brain/reading", { provider, model, raw: r.raw });
  if (kept.status !== 200) log(`${provider}: reading not kept (${kept.status}); the run carries on`);
  return r;
}

/** One AI reading with start, done and failed events for the live panel. */
async function timed(stage: Stage, model: string, words: string, ask: () => Promise<Reading>): Promise<Reading> {
  await step(words, { stage, state: "start", model });
  const t0 = Date.now();
  try {
    const r = await ask();
    await step(`${words.replace(/ is (reading|drawing)/, " finished $1")} in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s`, { stage, state: "done", model, tokens: r.tokensIn + r.tokensOut });
    return r;
  } catch (err) {
    await note(`${words.split(" ")[0]} stopped`, { stage, state: "fail", model });
    throw err;
  }
}

function checksFor(draft: Draft, idx: TextIndex | null, pages: string[], shape: Problem[]): Problem[] {
  return [...shape, ...(idx ? checkWords(draft, idx) : []), ...checkNumbers(draft), ...missingHeadings(draft, pages)];
}

// ---------- Pages sent to the AIs ----------

/**
 * A copy of the PDF with only these pages (original numbers, 1-based), as base64 for the AIs; the whole PDF when every
 * page is kept or the PDF cannot be split (then the AIs see all pages and the numbers need no mapping).
 */
async function slimPdf(bytes: Uint8Array, keep: readonly number[], total: number): Promise<{ pdf64: string; kept: number[] }> {
  const whole = { pdf64: Buffer.from(bytes).toString("base64"), kept: [] as number[] };
  if (!keep.length || keep.length >= total) return whole;
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (src.getPageCount() !== total) return whole;
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(src, keep.map((p) => p - 1))) out.addPage(page);
    return { pdf64: Buffer.from(await out.save({ useObjectStreams: false })).toString("base64"), kept: [...keep] };
  } catch (err) {
    log(`could not leave pages out (${err instanceof Error ? err.message.slice(0, 120) : "unknown"}); sending the whole PDF`);
    return whole;
  }
}

/** The PDF without its blank pages, with a note for the live panel. */
async function withoutBlankPages(bytes: Uint8Array, pages: readonly string[]): Promise<{ pdf64: string; kept: number[] }> {
  const blank = blankPages(pages);
  const slim = await slimPdf(bytes, keptPages(pages.length, blank), pages.length);
  if (slim.kept.length) await note(`Leaving out ${blank.length} blank page${blank.length === 1 ? "" : "s"} (${blank.join(", ")}): not paid for`, { stage: "pdf", state: "done" });
  return slim;
}

// ---------- Reading a paper (step 2b) ----------

const run = (cmd: string, args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (err, out) => (err ? reject(err) : resolve(out)));
});

/**
 * Cuts the figures out of the PDF as SVG (owner, 7 Nov 2026: no AI drawing). Poppler turns each figure page into SVG
 * and its text lines with boxes; figures.ts finds every figure's box (above its printed label, else the drawing that
 * matches its description); each page's art is stored so the admin can move a box by hand. Figures that already have
 * a box keep it unless the run names them. Free, about a second a paper.
 */
async function cutFigures(job: PaperJob, content: PaperContent, bytes: Uint8Array): Promise<PaperContent> {
  const need = content.figures.filter((f) => f.cut !== "manual" && (!f.box || job.scope.figures.includes(f.id)));
  if (!need.length) {
    await note("Figures: nothing to cut", { stage: "figures", state: "skip" });
    return content;
  }
  await step(`Cutting ${need.length} figure${need.length === 1 ? "" : "s"} from the PDF (no AI)`, { stage: "figures", state: "start" });
  try {
    await run("pdftocairo", ["-v"]).catch((e: { code?: string }) => {
      if (e.code === "ENOENT") throw e;
    });
  } catch {
    await note("Figures: the PDF tool (Poppler) is not installed here, so figures are left to draw by hand", { stage: "figures", state: "fail" });
    return content;
  }
  const dir = await mkdtemp(join(tmpdir(), "paper-"));
  const boxes = new Map<string, { box: Box; cut: FigureCut }>();
  try {
    const pdf = join(dir, "paper.pdf");
    await writeFile(pdf, bytes);
    const pages = [...new Set(need.map((f) => f.page))].sort((a, b) => a - b);
    for (const page of pages) {
      const out = join(dir, `p${page}.svg`);
      await run("pdftocairo", ["-svg", "-f", String(page), "-l", String(page), pdf, out]);
      const art = pageArt(await readFile(out, "utf8"), page);
      const lines = textLines(await run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdf, "-"]));
      const onPage = content.figures.filter((f) => f.page === page);
      const got = assignBoxes(onPage, findBoxes(art, lines), lines);
      for (const f of need) if (f.page === page && got.has(f.id)) boxes.set(f.id, got.get(f.id)!);
      const r = await api("/api/brain/figpage", { page, art });
      if (r.status !== 200) throw new Stop(`save_${r.status}`, "the page's drawing could not be stored");
    }
  } catch (e) {
    if (e instanceof Stop) throw e;
    log(`figures: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const lost = need.length - boxes.size;
  await note(`Cut ${boxes.size} of ${need.length} figure${need.length === 1 ? "" : "s"}${lost ? `; ${lost} to draw by hand on the review screen` : ""}`, { stage: "figures", state: "done" });
  return { ...content, figures: content.figures.map((f) => (boxes.has(f.id) ? { ...f, ...boxes.get(f.id)!, svg: "" } : f)) };
}

/**
 * Reads one question paper or mark scheme: Gemini first (free), then Claude, whose reading is merged with what was
 * stored (confirmed items stay) and saved at once; then the figures are cut from the PDF by code and the reading is
 * saved again with them. A scope reads only some items again, or only cuts some figures again.
 */
async function runPaper(job: PaperJob) {
  // The Reading AI reads papers (owner, 8 Nov 2026); without one the main AI does.
  const reader = job.models.reading || job.models.claude;
  const alone = job.readWith === "gemini";
  // A check asks no AI, so it needs no keys or models.
  if (!job.check) {
    if (!CLAUDE_KEY && !alone) throw new Stop("claude_key", "the GitHub secret CLAUDE_API_KEY is not set");
    if (!GEMINI_KEY) throw new Stop("gemini_key", "the GitHub secret GEMINI_API_KEY is not set");
    if ((!reader && !alone) || !job.models.gemini) throw new Stop("models", "no Claude or Gemini model is set (AI setup page or wrangler.jsonc)");
  }
  if (job.pdfBytes > job.limits.maxPdfBytes) throw new Stop("pdf_too_big");

  await step(job.batch ? `Paper ${job.batch.at} of ${job.batch.of}: ${job.paper}` : "Fetching the paper", { stage: "pdf", state: "start" });
  const doc = await api("/api/brain/doc", {});
  if (!doc.bytes?.length) throw new Stop("no_paper");
  const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
  // Each page's text, and the drawings and images on it (which pages Claude must see as pictures).
  const info = await allPagesInfo(doc.bytes, inflate);
  const rawPages = info.map((p) => p.text);
  // Notation and structure from where each word sits (owner, 9 Nov 2026): Poppler's word boxes give superscripts and
  // subscripts (^{208}_{81}Tl, H_{2}O, 10^{−10}) and the paper's questions, parts and lead-ins. Without Poppler the
  // pages stay as our own reader gives them.
  let pages = rawPages;
  let outline: OutlinePart[] = [];
  try {
    const dir = await mkdtemp(join(tmpdir(), "words-"));
    try {
      const pdf = join(dir, "paper.pdf");
      await writeFile(pdf, doc.bytes);
      // Fraction bars from each page's drawing (blank pages and the cover have none worth reading).
      const blank = blankPages(rawPages);
      const xml = await run("pdftotext", ["-bbox-layout", pdf, "-"]);
      const pageXml = [...xml.matchAll(/<page [^>]*>[\s\S]*?<\/page>/g)].map((m) => m[0]);
      const bars: Bar[][] = [];
      // Each labelled figure's drawing with its labels: left out of the outline, so a lead-in is only question text.
      const figs: Box[][] = [];
      for (let p = 1; p <= rawPages.length; p++) {
        if (p === 1 || blank.includes(p)) {
          bars.push([]);
          figs.push([]);
          continue;
        }
        const out = join(dir, `bars${p}.svg`);
        await run("pdftocairo", ["-svg", "-f", String(p), "-l", String(p), pdf, out]);
        const svg = await readFile(out, "utf8");
        bars.push(fractionBars(svg));
        try {
          const lines = textLines(pageXml[p - 1] ?? "");
          figs.push([...findBoxes(pageArt(svg, p), lines).captions.map((c) => c.box), ...labelBoxes(lines)]);
        } catch {
          figs.push([]);
        }
      }
      const n = notatedPages(rawPages, xml, bars);
      pages = n.pages;
      outline = pdfOutline(n.words, figs);
      log(`notation: ${n.found} superscripts and subscripts, ${n.fractions} fractions, text from ${n.from}; outline: ${outline.length} questions and parts`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch (e) {
    log(`notation: not read (${e instanceof Error ? e.message : String(e)})`);
  }
  await note(`The paper has ${pages.length} pages`, { stage: "pdf", state: "done" });
  // Readers get the paper without its blank pages; their page numbers are put back on the paper's own (remapPages).
  const slim = await withoutBlankPages(doc.bytes, rawPages);
  const pdf64 = slim.pdf64;
  const sentPages = slim.kept.length || pages.length;

  const scoped = job.scope.items.length > 0 || job.scope.figures.length > 0;
  const figuresOnly = !!job.check || (scoped && job.scope.items.length === 0);
  const prior = job.prior.content ? cleanPaper(job.prior.content, job.kind) : null;
  const priorGemini = job.prior.gemini ? cleanPaper(job.prior.gemini, job.kind) : null;
  const client = new Anthropic({ apiKey: CLAUDE_KEY || "not-set", maxRetries: TEST_MODE ? 0 : 3, timeout: 30 * 60_000, ...(CLAUDE_BASE ? { baseURL: CLAUDE_BASE } : {}) });
  // A full reading's own result before it is merged with what was kept: its score is this run's read accuracy, with
  // the models that read it (owner, 8 Nov 2026: compare a cheaper Claude with the one in use).
  let fresh: PaperContent | null = null;
  const save = async (content: PaperContent, gemini: PaperContent | null, final: boolean) => {
    // Gemini alone: its reading is the reading, so there is no second reader to compare with.
    const second = alone ? null : gemini;
    // A figure printed before a question's first part goes on its lead-in (owner, 9 Nov 2026).
    content = figuresToLeads(content);
    const flags = paperFlags({ content, pages, gemini: second, outline });
    if (final) await step(`Checks done: ${flags.length} flag${flags.length === 1 ? "" : "s"} for the review screen`, { stage: "checks", state: "done" });
    const own = final && fresh ? {
      fresh: { items: fresh.items.map((i) => ({ number: i.number, marks: i.marks })), flags: paperFlags({ content: fresh, pages, gemini: second, outline }) },
      models: { claude: alone ? "" : reader, gemini: job.models.gemini },
    } : {};
    // `read`: a full reading (not a figures-only run), so the first one sets the paper's read accuracy.
    const r = await api("/api/brain/paper", { content, gemini, pages, flags, final, read: !figuresOnly, ...own });
    if (r.status !== 200) throw new Stop(`save_${r.status}`);
    if (final) await note("Saved", { stage: "save", state: "done" });
  };

  // Gemini first: free on the owner's plan, so a failure here costs nothing. A figure redraw needs no reading.
  let gemini = priorGemini;
  if (!figuresOnly) {
    const g = await timed("gemini", job.models.gemini, "Gemini is reading the paper", () =>
      askGemini({ model: job.models.gemini, system: PAPER_SYSTEM, schema: PAPER_SCHEMA_GEMINI, prompt: paperPrompt(job.kind, job.paper), pdf64, pages: sentPages, limits: job.limits }));
    gemini = placeOnPages(remapPages(cleanPaper(g.raw, job.kind), slim.kept), pages);
  } else await note(job.check ? "Gemini: not asked (checking the reading again)" : "Gemini: not needed to cut a figure again", { stage: "gemini", state: "skip" });

  let content = prior;
  if (!figuresOnly && alone) {
    // Gemini alone (owner, 9 Nov 2026, "Read with"): Gemini's reading is merged and saved; Claude is not asked.
    if (!gemini?.items.length) throw new Stop("gemini_bad_answer", "Gemini's reading had no questions (it read alone)");
    await note("Claude: not asked (this reading is Gemini alone)", { stage: "claude", state: "skip" });
    if (!scoped) fresh = gemini;
    content = placeOnPages(mergeReading(prior, gemini, new Set(job.prior.open), scoped ? job.scope : undefined), pages);
    await step("Saving Gemini's reading", { stage: "save", state: "start" });
    await save(content, gemini, false);
  } else if (!figuresOnly) {
    // Claude sees only the figure pages as pictures; every other page goes as its text (far fewer tokens). A paper
    // whose text cannot be read goes whole, as before.
    const readable = pages.join("").replace(/\s/g, "").length >= BRAIN.minPaperTextChars;
    const blank = blankPages(rawPages);
    // Pictures are chosen on our reader's text (its scattered formula pieces are what makes a page a picture).
    const pics = picturePages(rawPages, blank, info, pages);
    const textOnly = keptPages(pages.length, [...blank, ...pics]);
    const mixed = readable && textOnly.length > 0;
    const claudePdf = mixed ? (pics.length ? (await slimPdf(doc.bytes, pics, pages.length)).pdf64 : "") : pdf64;
    if (mixed) await note(`Claude gets ${pics.length} page${pics.length === 1 ? "" : "s"} with figures as pictures and ${textOnly.length} as text`, { stage: "claude", state: "start", model: reader });
    const r = await timed("claude", reader, job.scope.items.length ? `Claude is reading ${job.scope.items.join(", ")} again` : "Claude is reading the paper", () =>
      askClaude(client, {
        model: reader, system: PAPER_SYSTEM, schema: PAPER_SCHEMA, pdf64: claudePdf, pages: mixed ? pics.length : sentPages, limits: job.limits,
        effort: job.limits.paperEffort, stage: "claude", label: "Claude",
        prompt: paperPrompt(job.kind, job.paper, job.scope.items, mixed ? { picturePages: pics, textPages: textOnly } : undefined),
        extraText: mixed ? textPagesBlock(pages, textOnly) : undefined,
      }));
    const read = placeOnPages(remapPages(cleanPaper(r.raw, job.kind), slim.kept), pages);
    if (!read.items.length) throw new Stop("claude_bad_answer", "the reading had no questions");
    if (!scoped) fresh = read;
    // Kept items are placed again too, so a page number stored wrongly before is put right.
    content = placeOnPages(mergeReading(prior, read, new Set(job.prior.open), scoped ? job.scope : undefined), pages);
    await step("Saving Claude's reading", { stage: "save", state: "start" });
    await save(content, gemini, false);
  } else await note(job.check ? "Claude: not asked (checking the reading again)" : "Claude: not needed to cut a figure again", { stage: "claude", state: "skip" });
  if (!content) throw new Stop("no_reading", "there is no reading to cut figures for");

  content = await cutFigures(job, content, doc.bytes);

  await step("Saving the reading", { stage: "save", state: "start" });
  await save(content, gemini, true);
  log(`saved: ${content.items.length} items, ${content.figures.length} figures`);
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
  if ((job as unknown as { task: string }).task === "paper") {
    // Read all: the papers one after another in this run. Each is saved before the next is asked for, and the site
    // checks the monthly cap before handing it out, so a stop never loses a paper already read.
    let paper = job as unknown as PaperJob;
    for (;;) {
      await runPaper(paper);
      if (!paper.batch) return;
      const n = await api("/api/brain/next", {});
      if (n.status !== 200 || !n.data) throw new Stop(n.status === 409 ? "closed" : `next_${n.status}`);
      if (n.data.done) {
        log(n.data.stopped ? `batch stopped: ${String(n.data.stopped)}` : "batch done");
        return;
      }
      paper = n.data as unknown as PaperJob;
    }
  }
  if (!CLAUDE_KEY) throw new Stop("claude_key", "the GitHub secret CLAUDE_API_KEY is not set");
  if (!GEMINI_KEY) throw new Stop("gemini_key", "the GitHub secret GEMINI_API_KEY is not set");
  if (!job.models.claude || !job.models.gemini) throw new Stop("models", "no Claude or Gemini model is set (AI setup page or wrangler.jsonc)");
  if (job.pdfBytes > job.limits.maxPdfBytes) throw new Stop("pdf_too_big");

  await step("Fetching the syllabus PDF", { stage: "pdf", state: "start" });
  const doc = await api("/api/brain/doc", {});
  if (!doc.bytes?.length) throw new Stop("no_syllabus");
  const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
  const pages = await allPagesText(doc.bytes, inflate);
  // The AIs get the syllabus without its blank pages (a topic tree has no page numbers, so nothing to map back).
  const { pdf64 } = await withoutBlankPages(doc.bytes, pages);
  const idx = textIndex(pages);
  const textChecked = idx.chars >= BRAIN.minTextChars;
  log(`syllabus: ${pages.length} pages, ${idx.chars} letters and digits; word check ${textChecked ? "on" : "off (text unreadable)"}`);
  await note(`The syllabus has ${pages.length} pages${textChecked ? "" : " (its text could not be read, so the word check is off)"}`, { stage: "pdf", state: "done" });

  const client = new Anthropic({ apiKey: CLAUDE_KEY, maxRetries: TEST_MODE ? 0 : 3, timeout: 30 * 60_000, ...(CLAUDE_BASE ? { baseURL: CLAUDE_BASE } : {}) });
  const usage = { claudeIn: 0, claudeOut: 0, geminiIn: 0, geminiOut: 0 };

  // Gemini first (free on the owner's plan): Claude, which costs money, starts only once Gemini's reading is safe, so
  // a Gemini failure costs nothing (owner, 7 Nov 2026). A reading kept from an earlier run of the same PDF and model
  // is reused instead of asked for again.
  const gem = await reading("gemini", job.models.gemini, "Gemini is reading the syllabus", () =>
    askGemini({ model: job.models.gemini, system: TOPIC_SYSTEM, schema: TOPIC_SCHEMA_GEMINI, prompt: topicPrompt(job.subject), pdf64, pages: pages.length, limits: job.limits }));
  usage.geminiIn += gem.tokensIn;
  usage.geminiOut += gem.tokensOut;
  const gemini = cleanDraft(gem.raw).draft;
  const topicAsk = (prompt: string, stage: Stage, label: string) =>
    askClaude(client, { model: job.models.claude, system: TOPIC_SYSTEM, schema: TOPIC_SCHEMA, prompt, pdf64, pages: pages.length, limits: job.limits, stage, label });
  const first = await reading("claude", job.models.claude, "Claude is reading the syllabus", () => topicAsk(topicPrompt(job.subject), "claude", "Claude"));
  usage.claudeIn += first.tokensIn;
  usage.claudeOut += first.tokensOut;

  let current = cleanDraft(first.raw);
  let attempts = 1;
  let problems = checksFor(current.draft, textChecked ? idx : null, pages, current.problems);
  let cmp = compareDrafts(current.draft, gemini, textChecked ? idx : null);
  log(`try 1: ${current.draft.topics.length} topics, ${current.draft.goals.length} goals, ${problems.length} problems, agreement ${(cmp.agreement * 100).toFixed(1)}%`);

  while (attempts < job.limits.attempts && !isReady({ textChecked, problems, agreement: cmp.agreement }) && (problems.length || cmp.disagreements.length)) {
    attempts++;
    await step(`Claude is checking ${problems.length + cmp.disagreements.length} points again (try ${attempts})`, { stage: "retry", state: "start", model: job.models.claude });
    const next = await topicAsk(retryPrompt(job.subject, retryNotes(problems, cmp.disagreements)), "retry", "Claude's second try");
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
  await step(`Checks done: ${problems.length} open, agreement with Gemini ${(cmp.agreement * 100).toFixed(1)}%`, { stage: "checks", state: "done" });
  await step("Saving the topic tree", { stage: "save", state: "start" });
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
