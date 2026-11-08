// AI usage, spend and the monthly cap (owner request 6 Nov 2026). Brain runs record every Claude and Gemini question
// with the tokens the service reported (`ai_spend`, migration 0021); spend is worked out from the prices the admin
// types on the AI setup page (setting 'ai_prices', US dollars per million tokens), so a missing price says "price
// not set" and is never guessed. The cap (setting 'ai_budget') stops a run whose rough cost would take the month past
// it. All figures are estimates; the real bill is on the Anthropic Console and in Google AI Studio.
// Takes the database as a parameter (unit tested on SQLite). No Next imports.
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { BRAIN } from "../config.ts";
import { aiModels } from "./aiSetup.ts";

export type Provider = "claude" | "gemini";
export type Price = { in: number; out: number };
export type Prices = Record<string, Price>;

export const SPEND_MODEL_RE = /^(claude|gemini)-[a-z0-9][a-z0-9.-]{0,60}$/;
const MAX_PRICE = 1_000;
const MAX_CAP = 100_000;

export const TASK_WORDS: Record<string, string> = {
  topics: "Topic trees",
  check: "AI setup checks",
  paper: "Reading papers",
  drawing: "Drawing figures",
};
export const taskWords = (t: string) => TASK_WORDS[t] ?? "Other runs";

async function readSetting(db: Db, key: string): Promise<unknown> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = ?1`).bind(key).first<{ value: string }>();
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

async function writeSetting(db: Db, key: string, value: unknown, actorId: string, now: number) {
  await db
    .prepare(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
              ON CONFLICT (key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4`)
    .bind(key, JSON.stringify(value), actorId, now)
    .run();
}

const okNum = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

/** Prices as stored, cleaned: only model names we know the shape of, only sane numbers. */
export function cleanPrices(v: unknown): Prices {
  const out: Prices = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    if (SPEND_MODEL_RE.test(k) && okNum(r.in, MAX_PRICE) && okNum(r.out, MAX_PRICE)) out[k] = { in: r.in as number, out: r.out as number };
  }
  return out;
}

export async function readPrices(db: Db): Promise<Prices> {
  return cleanPrices(await readSetting(db, "ai_prices"));
}

/** A typed amount ("2", "0.075", "$1.25"), or null when it is not one. Empty is null too. */
export function parseAmount(v: unknown, max: number): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^\$/, "");
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) return null;
  const n = Number(s);
  return n <= max ? n : null;
}

/** Saves one model's prices; both boxes empty removes the price. */
export async function savePrice(db: Db, model: unknown, inp: unknown, out: unknown, actorId: string, now = Date.now()): Promise<"ok_price" | "bad_price"> {
  if (typeof model !== "string" || !SPEND_MODEL_RE.test(model)) return "bad_price";
  const prices = await readPrices(db);
  const blank = (v: unknown) => typeof v === "string" && v.trim() === "";
  if (blank(inp) && blank(out)) delete prices[model];
  else {
    const i = parseAmount(inp, MAX_PRICE);
    const o = parseAmount(out, MAX_PRICE);
    if (i === null || o === null) return "bad_price";
    prices[model] = { in: i, out: o };
  }
  await writeSetting(db, "ai_prices", prices, actorId, now);
  await audit(db, { actorId, action: "brain.price", entity: "setting", entityId: "ai_prices", detail: { model, in: prices[model]?.in ?? -1, out: prices[model]?.out ?? -1 } }, now);
  return "ok_price";
}

/** The monthly cap in US dollars; 0 means no cap. */
export async function readCap(db: Db): Promise<number> {
  const v = await readSetting(db, "ai_budget");
  const n = v && typeof v === "object" ? (v as { monthlyUsd?: unknown }).monthlyUsd : null;
  return okNum(n, MAX_CAP) ? (n as number) : 0;
}

/** Saves the cap; an empty box or 0 removes it. */
export async function saveCap(db: Db, value: unknown, actorId: string, now = Date.now()): Promise<"ok_cap" | "bad_cap"> {
  const n = typeof value === "string" && value.trim() === "" ? 0 : parseAmount(value, MAX_CAP);
  if (n === null) return "bad_cap";
  await writeSetting(db, "ai_budget", { monthlyUsd: n }, actorId, now);
  await audit(db, { actorId, action: "brain.cap", entity: "setting", entityId: "ai_budget", detail: { monthlyUsd: n } }, now);
  return "ok_cap";
}

/** Dollars for these tokens, or null when the model has no price. */
export function costUsd(tokensIn: number, tokensOut: number, price: Price | undefined): number | null {
  return price ? (tokensIn * price.in + tokensOut * price.out) / 1_000_000 : null;
}

export type UsageEntry = { provider: Provider; model: string; calls: number; pages: number; tokensIn: number; tokensOut: number };

const int = (v: unknown, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** One usage report from the brain script, made safe. Null when it is not one. */
export function cleanUsage(v: unknown): UsageEntry | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const provider = o.provider === "claude" || o.provider === "gemini" ? o.provider : null;
  const model = typeof o.model === "string" ? o.model : "";
  if (!provider || !SPEND_MODEL_RE.test(model) || !model.startsWith(`${provider}-`)) return null;
  const calls = int(o.calls, 100);
  const pages = int(o.pages ?? 0, 5_000);
  const tokensIn = int(o.tokensIn, 50_000_000);
  const tokensOut = int(o.tokensOut, 50_000_000);
  if (calls === null || calls < 1 || pages === null || tokensIn === null || tokensOut === null) return null;
  return { provider, model, calls, pages, tokensIn, tokensOut };
}

export async function recordSpend(db: Db, jobId: string | null, task: string, e: UsageEntry, now = Date.now()): Promise<void> {
  await db
    .prepare(`INSERT INTO ai_spend (id, job_id, task, provider, model, calls, pages, input_tokens, output_tokens, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
    .bind(randomId(), jobId, task.slice(0, 20), e.provider, e.model, e.calls, e.pages, e.tokensIn, e.tokensOut, now)
    .run();
}

// ---------- Months ----------

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A month as UTC bounds: "2026-11", or the month of `now` when not given or not valid. */
export function monthBounds(month: string | undefined, now = Date.now()): { key: string; from: number; to: number; label: string; prev: string; next: string | null } {
  const d = new Date(now);
  const m = MONTH_RE.exec(month ?? "");
  const y = m ? Number(m[1]) : d.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : d.getUTCMonth();
  const from = Date.UTC(y, mo, 1);
  const to = Date.UTC(y, mo + 1, 1);
  const key = (t: number) => new Date(t).toISOString().slice(0, 7);
  const thisMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return { key: key(from), from, to, label: monthName.format(from), prev: key(Date.UTC(y, mo - 1, 1)), next: to <= thisMonth ? key(to) : null };
}

export const dayStart = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// ---------- Summaries ----------

export type SpendRow = { provider: Provider; model: string; task: string; calls: number; pages: number; tokensIn: number; tokensOut: number };
export type SpendLine = { calls: number; pages: number; tokensIn: number; tokensOut: number; usd: number | null };
export type Summary = {
  total: number;
  /** Models used in this span without a price (their spend is left out of the total). */
  unpriced: string[];
  byModel: (SpendLine & { provider: Provider; model: string })[];
  byTask: (SpendLine & { task: string })[];
};

export async function spendRows(db: Db, from: number, to: number): Promise<SpendRow[]> {
  const { results } = await db
    .prepare(`SELECT provider, model, task, SUM(calls) AS calls, SUM(pages) AS pages, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout
              FROM ai_spend WHERE at >= ?1 AND at < ?2 GROUP BY provider, model, task`)
    .bind(from, to)
    .all<{ provider: Provider; model: string; task: string; calls: number; pages: number; tin: number; tout: number }>();
  return results.map((r) => ({ provider: r.provider, model: r.model, task: r.task, calls: r.calls, pages: r.pages, tokensIn: r.tin, tokensOut: r.tout }));
}

/** Totals by model and by job from grouped rows. Pure. */
export function summarise(rows: readonly SpendRow[], prices: Prices): Summary {
  const add = (a: SpendLine, r: SpendRow, usd: number | null): SpendLine => ({
    calls: a.calls + r.calls, pages: a.pages + r.pages, tokensIn: a.tokensIn + r.tokensIn, tokensOut: a.tokensOut + r.tokensOut,
    usd: a.usd === null || usd === null ? null : a.usd + usd,
  });
  const empty = (): SpendLine => ({ calls: 0, pages: 0, tokensIn: 0, tokensOut: 0, usd: 0 });
  const models = new Map<string, SpendLine & { provider: Provider; model: string }>();
  const tasks = new Map<string, SpendLine>();
  const unpriced = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const usd = costUsd(r.tokensIn, r.tokensOut, prices[r.model]);
    if (usd === null) unpriced.add(r.model);
    else total += usd;
    const m = models.get(r.model) ?? { ...empty(), provider: r.provider, model: r.model };
    models.set(r.model, { ...add(m, r, usd), provider: r.provider, model: r.model });
    // By job: an unpriced model leaves the job's own sum as the priced part (named "price not set" on the page).
    tasks.set(r.task, add(tasks.get(r.task) ?? empty(), r, usd ?? 0));
  }
  return {
    total,
    unpriced: [...unpriced].sort(),
    byModel: [...models.values()].sort((a, b) => a.provider.localeCompare(b.provider) || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)),
    byTask: [...tasks.entries()].map(([task, l]) => ({ ...l, task })).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)),
  };
}

export async function spendBetween(db: Db, from: number, to: number, prices: Prices): Promise<Summary> {
  return summarise(await spendRows(db, from, to), prices);
}

export type RunSpend = { jobId: string; task: string; status: string | null; at: number; syllabusId: string | null; models: string[]; tokens: number; usd: number | null };

/** The latest runs that used an AI, newest first, with their spend. */
export async function recentRuns(db: Db, prices: Prices, limit = 20): Promise<RunSpend[]> {
  const { results } = await db
    .prepare(`SELECT s.job_id, s.task, s.model, SUM(s.input_tokens) AS tin, SUM(s.output_tokens) AS tout, MAX(s.at) AS at, j.status, j.params
              FROM ai_spend s LEFT JOIN job j ON j.id = s.job_id
              WHERE s.job_id IN (SELECT job_id FROM ai_spend WHERE job_id IS NOT NULL GROUP BY job_id ORDER BY MAX(at) DESC LIMIT ?1)
              GROUP BY s.job_id, s.model ORDER BY at DESC`)
    .bind(limit)
    .all<{ job_id: string; task: string; model: string; tin: number; tout: number; at: number; status: string | null; params: string | null }>();
  const runs = new Map<string, RunSpend>();
  for (const r of results) {
    let syllabusId: string | null = null;
    try {
      const p = r.params ? (JSON.parse(r.params) as { syllabusId?: unknown }) : {};
      syllabusId = typeof p.syllabusId === "string" ? p.syllabusId : null;
    } catch {
      syllabusId = null;
    }
    const usd = costUsd(r.tin, r.tout, prices[r.model]);
    const run = runs.get(r.job_id) ?? { jobId: r.job_id, task: r.task, status: r.status, at: r.at, syllabusId, models: [], tokens: 0, usd: 0 };
    run.models.push(r.model);
    run.tokens += r.tin + r.tout;
    run.usd = run.usd === null || usd === null ? null : run.usd + usd;
    run.at = Math.max(run.at, r.at);
    runs.set(r.job_id, run);
  }
  return [...runs.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Workers AI (the agent's helper) in the same span, from its own meter (`ai_usage`, one row per UTC day). */
export async function workersAiBetween(db: Db, from: number, to: number): Promise<{ calls: number; tokensIn: number; tokensOut: number }> {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const r = await db
    .prepare(`SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS tin, COALESCE(SUM(output_tokens), 0) AS tout FROM ai_usage WHERE day >= ?1 AND day < ?2`)
    .bind(day(from), day(to))
    .first<{ calls: number; tin: number; tout: number }>();
  return { calls: r?.calls ?? 0, tokensIn: r?.tin ?? 0, tokensOut: r?.tout ?? 0 };
}

// ---------- Rough cost before a run, and the cap ----------

export type Estimate = { usd: number | null; basis: "history" | "rough"; missing: string[] };
export type ModelHistory = { model: string; runs: number; tokensIn: number; tokensOut: number };

/** Past topic tree runs per model (all of them, averaged per run on the way out). */
export async function taskHistory(db: Db, task: string, models: readonly string[]): Promise<ModelHistory[]> {
  const list = models.filter((m) => SPEND_MODEL_RE.test(m));
  if (!list.length) return [];
  const { results } = await db
    .prepare(`SELECT model, COUNT(DISTINCT job_id) AS runs, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout FROM ai_spend
              WHERE task = ?1 AND job_id IS NOT NULL AND model IN (${list.map((_, i) => `?${i + 2}`).join(", ")}) GROUP BY model`)
    .bind(task, ...list)
    .all<{ model: string; runs: number; tin: number; tout: number }>();
  return results.map((r) => ({ model: r.model, runs: r.runs, tokensIn: r.tin, tokensOut: r.tout }));
}

/**
 * Rough cost of one topic tree run: the average of past runs on the same models, or, with no history, the PDF's
 * size turned into pages and tokens (BRAIN.est*), Claude reading it up to BRAIN.attempts times and Gemini once.
 * Pure.
 */
export function estimateTopics(models: { claude: string; gemini: string }, pdfBytes: number, history: readonly ModelHistory[], prices: Prices): Estimate {
  const pages = Math.max(1, Math.ceil(pdfBytes / BRAIN.estBytesPerPage));
  const missing = [models.claude, models.gemini].filter((m) => !prices[m]);
  let usd = 0;
  let fromHistory = true;
  for (const [model, reads] of [[models.claude, BRAIN.attempts], [models.gemini, 1]] as const) {
    const h = history.find((x) => x.model === model && x.runs > 0);
    const tin = h ? h.tokensIn / h.runs : pages * BRAIN.estTokensPerPage * reads;
    const tout = h ? h.tokensOut / h.runs : BRAIN.estOutTokens * reads;
    if (!h) fromHistory = false;
    usd += costUsd(tin, tout, prices[model]) ?? 0;
  }
  return { usd: missing.length ? null : usd, basis: fromHistory ? "history" : "rough", missing };
}

export type CapResult = "ok" | "over_cap" | "no_price";

/** May a run start? No cap: always. With a cap: only when its cost is known and stays inside the month. Pure. */
export function capCheck(cap: number, spentThisMonth: number, estimate: Estimate): CapResult {
  if (cap <= 0) return "ok";
  if (estimate.usd === null) return "no_price";
  return spentThisMonth + estimate.usd > cap ? "over_cap" : "ok";
}

/** Dollars as words on a page: "$0.42", "under $0.01", "$12.50". */
export function usdWords(usd: number | null): string {
  if (usd === null) return "price not set";
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

export type CostCheck = { estimate: Estimate; cap: number; spent: number; verdict: CapResult };

/** Everything a Draft button needs: the run's rough cost, this month's spend, the cap and whether it may start. */
export async function topicsCostCheck(db: Db, env: { CLAUDE_MODEL?: string; GEMINI_MODEL?: string }, pdfBytes: number, now = Date.now()): Promise<CostCheck> {
  const [models, prices, cap] = await Promise.all([aiModels(db, env), readPrices(db), readCap(db)]);
  const month = monthBounds(undefined, now);
  const [history, summary] = await Promise.all([taskHistory(db, "topics", [models.claude, models.gemini]), spendBetween(db, month.from, month.to, prices)]);
  const estimate = estimateTopics(models, pdfBytes, history, prices);
  return { estimate, cap, spent: summary.total, verdict: capCheck(cap, summary.total, estimate) };
}

/** The rough cost in words, for the line beside a Draft button. */
export function estimateWords(e: Estimate): string {
  if (e.usd === null) return `Rough cost: unknown (price not set for ${e.missing.join(" and ")}; add it on the AI setup page).`;
  return `Rough cost: about ${usdWords(e.usd)} (${e.basis === "history" ? "the average of past runs" : "a guess from the PDF's size; past runs will make it closer"}).`;
}

/**
 * Rough cost of one paper reading: Gemini and Claude read it once; figures are cut from the PDF with no AI (owner,
 * 7 Nov 2026), so the drawing AI is no longer counted. Past paper runs on the same models replace the size guess. Pure.
 */
export function estimatePaper(models: { claude: string; gemini: string }, pdfBytes: number, history: { paper: readonly ModelHistory[] }, prices: Prices): Estimate {
  const pages = Math.max(1, Math.ceil(pdfBytes / BRAIN.estBytesPerPage));
  const parts = [
    { model: models.gemini, h: history.paper.find((x) => x.model === models.gemini && x.runs > 0) },
    { model: models.claude, h: history.paper.find((x) => x.model === models.claude && x.runs > 0) },
  ];
  const missing = [...new Set(parts.map((p) => p.model).filter((m) => !prices[m]))];
  let usd = 0;
  for (const p of parts) {
    const tin = p.h ? p.h.tokensIn / p.h.runs : pages * BRAIN.estTokensPerPage;
    const tout = p.h ? p.h.tokensOut / p.h.runs : BRAIN.estOutTokens;
    usd += costUsd(tin, tout, prices[p.model]) ?? 0;
  }
  return { usd: missing.length ? null : usd, basis: parts.every((p) => p.h) ? "history" : "rough", missing };
}

/** The Read this paper button's check: rough cost, this month's spend, the cap. */
export async function paperCostCheck(db: Db, env: { CLAUDE_MODEL?: string; GEMINI_MODEL?: string }, pdfBytes: number, now = Date.now()): Promise<CostCheck> {
  const [models, prices, cap] = await Promise.all([aiModels(db, env), readPrices(db), readCap(db)]);
  const month = monthBounds(undefined, now);
  const [paper, summary] = await Promise.all([taskHistory(db, "paper", [models.claude, models.gemini]), spendBetween(db, month.from, month.to, prices)]);
  const estimate = estimatePaper(models, pdfBytes, { paper }, prices);
  return { estimate, cap, spent: summary.total, verdict: capCheck(cap, summary.total, estimate) };
}
