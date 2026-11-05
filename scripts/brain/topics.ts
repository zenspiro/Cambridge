// The subject brain, step 1: the topic tree. Runs in GitHub Actions (.github/workflows/brain.yml):
//   node scripts/brain/topics.ts
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

type Job = {
  task: "topics";
  subject: string;
  pdfBytes: number;
  models: { claude: string; gemini: string };
  limits: { attempts: number; claudeMaxTokens: number; claudeEffort: "low" | "medium" | "high" | "xhigh" | "max"; geminiMaxTokens: number; maxPdfBytes: number };
};

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

// ---------- The two readers ----------

type Reading = { raw: unknown; tokensIn: number; tokensOut: number };

async function askClaude(client: Anthropic, job: Job, pdf64: string, prompt: string): Promise<Reading> {
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

async function askGemini(job: Job, pdf64: string): Promise<Reading> {
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(job.models.gemini)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20 * 60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TOPIC_SYSTEM }] },
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdf64 } }, { text: topicPrompt(job.subject) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: TOPIC_SCHEMA_GEMINI, maxOutputTokens: job.limits.geminiMaxTokens },
    }),
  });
  if (res.status === 404) throw new Stop("gemini_model", `model "${job.models.gemini}" not found. Available: ${await geminiModels()}`);
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Stop("gemini_key", `Gemini refused (${res.status}): ${(await res.text()).slice(0, 300)}`);
  if (!res.ok) throw new Stop("gemini_error", `Gemini error ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const c = data.candidates?.[0];
  if (c?.finishReason === "MAX_TOKENS") throw new Stop("gemini_too_long");
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Stop("gemini_bad_answer");
  }
  const u = data.usageMetadata ?? {};
  return { raw, tokensIn: u.promptTokenCount ?? 0, tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

/** The model names Gemini offers, for the run log when the configured one is not found. */
async function geminiModels(): Promise<string> {
  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=100`, { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(30_000) });
    const d = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (d.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, "")).join(", ");
  } catch {
    return "(could not list)";
  }
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
  if (!CLAUDE_KEY) throw new Stop("claude_key", "the GitHub secret CLAUDE_API_KEY is not set");
  if (!GEMINI_KEY) throw new Stop("gemini_key", "the GitHub secret GEMINI_API_KEY is not set");
  if (!job.models.claude || !job.models.gemini) throw new Stop("models", "CLAUDE_MODEL and GEMINI_MODEL must be set in wrangler.jsonc");
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
  const [first, gem] = await Promise.all([askClaude(client, job, pdf64, topicPrompt(job.subject)), askGemini(job, pdf64)]);
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
    const next = await askClaude(client, job, pdf64, retryPrompt(job.subject, retryNotes(problems, cmp.disagreements)));
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
