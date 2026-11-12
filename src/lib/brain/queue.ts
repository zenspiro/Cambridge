// The run queue (owner, 12 Nov 2026): only one brain run goes at a time, so a Read all, a benchmark read or a check
// pressed while another run goes on waits in the queue and starts on its own when that run ends. The queue holds what
// was asked (subject and choice), never a list of papers: the list is worked out again when it starts, so a paper read
// meanwhile is skipped and the cost is checked against the cap at that moment. Kept in setting `brain_queue`.
// Takes the database as a parameter; no Next imports.
import { BRAIN, SESSION_LABELS } from "../config.ts";
import type { Db } from "../db.ts";
import type { AppEnv } from "../env.ts";
import { randomId } from "../auth/crypto.ts";
import { reportError } from "../errors.ts";
import { audit } from "../auth/session.ts";
import { dispatchBrain, type DispatchResult } from "../agent/github.ts";
import { getLibrarySettings } from "../settings.ts";
import { loadSyllabus } from "../library/catalog.ts";
import { loadPapers } from "../library/papers.ts";
import { benchFilesFor } from "./benchmark.ts";
import { filterWords, planBatch, planBenchmark, readStates, type ReadFilter } from "./readAll.ts";
import { closeStaleBrainRuns, failBrainRun, startBatchRun } from "./runs.ts";
import { batchCostCheck } from "./spend.ts";

export type BatchAsk =
  | { kind: "read"; code: string; filter: ReadFilter }
  | { kind: "benchmark"; code: string; again?: boolean }
  | { kind: "check"; code: string }
  | { kind: "second"; code: string };
export type QueueItem = BatchAsk & { id: string; actorId: string; at: number; held?: string; heldAt?: number };

/** Why a queued run did not start when its turn came; it stays first in the queue until started or removed. */
export type Hold = "over_cap" | "no_price" | "gemini_down" | "github" | "not_set_up";
const HOLDS: readonly string[] = ["over_cap", "no_price", "gemini_down", "github", "not_set_up"];
/** A run that stopped for one of these would stop the next one too: the queue waits for the owner. */
const HOLD_AFTER: Readonly<Record<string, Hold>> = { gemini_down: "gemini_down", gemini_busy: "gemini_down", batch_cap: "over_cap", batch_price: "no_price", gemini_key: "gemini_down", claude_key: "not_set_up" };

const CODE_RE = /^[0-9]{4}$/;
const KEY = "brain_queue";

/** The words for one ask, as the Read all card and the messages show it. */
export function askWords(a: BatchAsk): string {
  if (a.kind === "benchmark") return `${a.code} benchmark papers${a.again ? " again, for the score" : ""}`;
  if (a.kind === "check") return `${a.code} checks again`;
  if (a.kind === "second") return `${a.code} checked with Gemini`;
  return `${a.code} ${filterWords(a.filter, SESSION_LABELS)}`;
}

const sameAsk = (a: BatchAsk, b: BatchAsk) => askWords(a) === askWords(b) && a.kind === b.kind;

function cleanItem(v: unknown): QueueItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.code !== "string" || !CODE_RE.test(o.code) || typeof o.actorId !== "string" || typeof o.at !== "number") return null;
  const base = { id: o.id.slice(0, 40), code: o.code, actorId: o.actorId.slice(0, 80), at: o.at, ...(typeof o.held === "string" && HOLDS.includes(o.held) ? { held: o.held, heldAt: typeof o.heldAt === "number" ? o.heldAt : o.at } : {}) };
  if (o.kind === "benchmark") return { ...base, kind: "benchmark", ...(o.again === true ? { again: true } : {}) };
  if (o.kind === "check") return { ...base, kind: "check" };
  if (o.kind === "second") return { ...base, kind: "second" };
  if (o.kind !== "read" || !o.filter || typeof o.filter !== "object") return null;
  const f = o.filter as Record<string, unknown>;
  const tier = f.tier === "core" || f.tier === "extended" || f.tier === "any" ? f.tier : null;
  const session = f.session === "m" || f.session === "s" || f.session === "w" ? f.session : null;
  const year = typeof f.year === "number" && Number.isInteger(f.year) ? f.year : null;
  return tier ? { ...base, kind: "read", filter: { tier, session, year } } : null;
}

export async function readQueue(db: Db): Promise<QueueItem[]> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = ?1`).bind(KEY).first<{ value: string }>();
  try {
    const v: unknown = JSON.parse(row?.value ?? "[]");
    return Array.isArray(v) ? v.flatMap((x) => cleanItem(x) ?? []) : [];
  } catch {
    return [];
  }
}

async function writeQueue(db: Db, items: readonly QueueItem[], actorId: string, now: number) {
  await db
    .prepare(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
              ON CONFLICT (key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = ?4`)
    .bind(KEY, JSON.stringify(items.slice(0, BRAIN.maxQueue)), actorId, now)
    .run();
}

/** Adds an ask to the end of the queue. "dupe" when the same ask is waiting already, "full" past BRAIN.maxQueue. */
export async function queueAsk(db: Db, ask: BatchAsk, actorId: string, now = Date.now()): Promise<"ok" | "dupe" | "full"> {
  const q = await readQueue(db);
  if (q.some((x) => sameAsk(x, ask))) return "dupe";
  if (q.length >= BRAIN.maxQueue) return "full";
  await writeQueue(db, [...q, { ...ask, id: randomId(), actorId, at: now }], actorId, now);
  await audit(db, { actorId, action: "brain.queue_add", entity: "setting", entityId: KEY, detail: { ask: askWords(ask) } }, now);
  return "ok";
}

/** Removes one waiting ask (the Read all card's Remove). */
export async function unqueue(db: Db, id: string, actorId: string, now = Date.now()): Promise<boolean> {
  const q = await readQueue(db);
  const item = q.find((x) => x.id === id);
  if (!item) return false;
  await writeQueue(db, q.filter((x) => x.id !== id), actorId, now);
  await audit(db, { actorId, action: "brain.queue_remove", entity: "setting", entityId: KEY, detail: { ask: askWords(item) } }, now);
  return true;
}

/** The papers an ask reads now (worked out from the library, never from a form). */
export async function planAsk(db: Db, ask: BatchAsk): Promise<{ docs: string[]; sizes: number[] } | null> {
  if (ask.kind === "second") {
    // Check with Gemini (owner, 12 Nov 2026): the papers whose last reading Claude made alone.
    const { results } = await db
      .prepare(`SELECT p.doc_id, d.size_bytes FROM paper_read p JOIN source_document d ON d.id = p.doc_id
                WHERE p.read_at IS NOT NULL AND d.status = 'stored' AND d.syllabus_id LIKE ?1
                  AND json_valid(p.scores) AND json_array_length(p.scores) > 0
                  AND COALESCE(json_extract(p.scores, '$[#-1].claude'), '') <> '' AND COALESCE(json_extract(p.scores, '$[#-1].gemini'), '') = ''
                ORDER BY d.file_name LIMIT ?2`)
      .bind(`${ask.code}-%`, BRAIN.maxBatchPapers)
      .all<{ doc_id: string; size_bytes: number }>();
    return { docs: results.map((r) => r.doc_id), sizes: results.map((r) => r.size_bytes) };
  }
  if (ask.kind === "check") {
    const { results } = await db
      .prepare(`SELECT p.doc_id, d.size_bytes FROM paper_read p JOIN source_document d ON d.id = p.doc_id
                WHERE p.read_at IS NOT NULL AND d.status = 'stored' AND d.syllabus_id LIKE ?1 ORDER BY d.file_name LIMIT ?2`)
      .bind(`${ask.code}-%`, BRAIN.maxBatchPapers)
      .all<{ doc_id: string; size_bytes: number }>();
    return { docs: results.map((r) => r.doc_id), sizes: results.map((r) => r.size_bytes) };
  }
  const state = await readStates(db, ask.code);
  if (ask.kind === "benchmark") {
    const files = benchFilesFor(ask.code);
    if (!files.length) return null;
    const plan = await planBenchmark(db, files, state);
    // Again, for the score (owner, 12 Nov 2026): every stored benchmark paper, read afresh into the AI's own copy.
    const list = ask.again ? plan.stored : plan.toRead;
    return { docs: list.map((d) => d.docId), sizes: list.map((d) => d.bytes) };
  }
  const lib = await getLibrarySettings(db);
  const [list, { papers }] = await Promise.all([loadSyllabus(db, ask.code, lib), loadPapers(db, ask.code)]);
  if (!list) return null;
  const plan = planBatch(list, papers, ask.filter, state);
  return { docs: plan.toRead.map((d) => d.docId), sizes: plan.toRead.map((d) => d.bytes) };
}

export type Launch = "ok_batch" | "ok_check" | "ok_second" | "ok_queued" | "queue_dupe" | "queue_full" | "batch_none" | "check_none" | "second_none" | "bad" | Hold;
type Dispatch = (env: AppEnv, jobId: string) => Promise<DispatchResult>;

/** Starts the run for an ask now. "running" when another brain run is going on (nothing changed). */
async function startAsk(db: Db, env: AppEnv, ask: BatchAsk, actorId: string, dispatch: Dispatch, now: number): Promise<Launch | "running"> {
  const plan = await planAsk(db, ask);
  if (!plan) return "bad";
  if (!plan.docs.length) return ask.kind === "check" ? "check_none" : ask.kind === "second" ? "second_none" : "batch_none";
  // A check asks no paid AI (Gemini is free), so the cap does not apply.
  if (ask.kind !== "check" && ask.kind !== "second") {
    const cost = await batchCostCheck(db, env, plan.sizes, now);
    if (cost.verdict !== "ok") return cost.verdict;
  }
  const isCheck = ask.kind === "check" || ask.kind === "second";
  const jobId = await startBatchRun(db, plan.docs, askWords(ask), actorId, now, isCheck, ask.kind === "benchmark" && !!ask.again, ask.kind === "second");
  if (!jobId) return "running";
  let failure: string | null = null;
  try {
    const d = await dispatch(env, jobId);
    if (!d.ok) failure = d.reason === "not_set_up" ? "not_set_up" : `github_${d.status ?? "error"}`;
  } catch (err) {
    failure = "github_unreachable";
    reportError("brain.dispatch", err);
  }
  if (failure) {
    if (failure !== "not_set_up") reportError("brain.dispatch", new Error(failure));
    await failBrainRun(db, jobId, failure, now);
    return failure === "not_set_up" ? "not_set_up" : "github";
  }
  return ask.kind === "check" ? "ok_check" : ask.kind === "second" ? "ok_second" : "ok_batch";
}

/**
 * Read all, the benchmark papers or the checks again, pressed on a subject: starts now, or waits in the queue when
 * another brain run is going on ("ok_queued").
 */
export async function launchAsk(db: Db, env: AppEnv, ask: BatchAsk, actorId: string, dispatch: Dispatch = dispatchBrain, now = Date.now()): Promise<Launch> {
  // Something is waiting already: this one joins the end, so asks start in the order they were made.
  const waiting = (await readQueue(db)).length > 0;
  const r = waiting ? "running" : await startAsk(db, env, ask, actorId, dispatch, now);
  if (r !== "running") return r;
  // Only asks that will have papers to read wait (a plan with none is answered now).
  const plan = await planAsk(db, ask);
  if (!plan) return "bad";
  if (!plan.docs.length) return ask.kind === "check" ? "check_none" : ask.kind === "second" ? "second_none" : "batch_none";
  const q = await queueAsk(db, ask, actorId, now);
  return q === "ok" ? "ok_queued" : q === "dupe" ? "queue_dupe" : "queue_full";
}

/**
 * A brain run has ended (or a page found none going on): the first waiting ask starts. An ask with nothing left to
 * read is dropped and the next one tried; one that cannot start (over the cap, GitHub refused) stays first with the
 * reason, and so does the queue after a run that stopped for a reason that would stop the next one too (`lastStop`).
 * `force` (Start now on the card) clears that hold first.
 */
export async function startQueued(db: Db, env: AppEnv, opts: { lastStop?: string | null; force?: boolean; dispatch?: Dispatch; now?: number } = {}): Promise<Launch | "running" | "empty"> {
  const now = opts.now ?? Date.now();
  const dispatch = opts.dispatch ?? dispatchBrain;
  await closeStaleBrainRuns(db, now);
  // Cheap first: a run going on means nothing starts (the insert checks it again).
  const going = await db.prepare(`SELECT 1 AS n FROM job WHERE type = 'brain' AND status IN ('queued', 'running') LIMIT 1`).bind().first();
  if (going) return "running";
  for (let tries = 0; tries < BRAIN.maxQueue; tries++) {
    const q = await readQueue(db);
    const first = q[0];
    if (!first) return "empty";
    const hold = opts.lastStop ? HOLD_AFTER[opts.lastStop] : undefined;
    if (hold && !opts.force) {
      await writeQueue(db, [{ ...first, held: hold, heldAt: now }, ...q.slice(1)], "brain", now);
      return hold;
    }
    // Gemini down passes: a hold for it is tried again on its own after BRAIN.queueRetryMs; other holds wait for Start now.
    const retry = first.held === "gemini_down" && now - (first.heldAt ?? now) >= BRAIN.queueRetryMs;
    if (first.held && !opts.force && !retry) return first.held as Hold;
    const r = await startAsk(db, env, first, first.actorId, dispatch, now);
    if (r === "running") return r;
    const fresh = await readQueue(db);
    if (r === "ok_batch" || r === "ok_check" || r === "ok_second" || r === "batch_none" || r === "check_none" || r === "second_none" || r === "bad") {
      await writeQueue(db, fresh.filter((x) => x.id !== first.id), "brain", now);
      await audit(db, { actorId: first.actorId, action: r.startsWith("ok") ? "brain.queue_start" : "brain.queue_drop", entity: "setting", entityId: KEY, detail: { ask: askWords(first) } }, now);
      if (r.startsWith("ok")) return r;
      continue;
    }
    await writeQueue(db, fresh.map((x) => (x.id === first.id ? { ...x, held: r, heldAt: now } : x)), "brain", now);
    return r;
  }
  return "empty";
}
