// AI setup (owner, 6 Nov 2026): which models the subject brain uses, and the "Check AI setup" run that asks Google
// which Gemini models the owner's key can use (and which work on its plan, free or paid) and tries each AI once.
// The run happens on GitHub, where the keys are. The Gemini model chosen here (setting 'ai_models') wins over the
// Worker var GEMINI_MODEL, so a model change needs no code change. Takes the database as a parameter. No Next imports.
import type { Db } from "../db.ts";
import { audit } from "../auth/session.ts";
import { BRAIN } from "../config.ts";

export const GEMINI_MODEL_RE = /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/;

export type ModelStatus = "ok" | "busy" | "not_on_plan" | "not_found" | "refused" | "no_credit" | "error" | "untested";
export type ModelTry = { name: string; label: string; status: ModelStatus; detail: string };
export type AiCheck = {
  at: number;
  claude: { model: string; status: ModelStatus; detail: string };
  gemini: { model: string; status: ModelStatus; detail: string };
  /** Gemini models the key may use for text, the ones tried with their result. */
  models: ModelTry[];
};

export const STATUS_WORDS: Record<ModelStatus, string> = {
  ok: "Works",
  busy: "Limit reached for now (try later, or it needs a paid plan for this much use)",
  not_on_plan: "Not on your plan (no free use of this model)",
  not_found: "Model name not known",
  refused: "Key refused",
  no_credit: "No credit on the account",
  error: "The service gave an error",
  untested: "Not tried",
};

const STATUSES = Object.keys(STATUS_WORDS) as ModelStatus[];

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

export type AiModels = { claude: string; gemini: string; geminiChosen: boolean };

/** The models runs use: Claude from the Worker var, Gemini as chosen on the AI setup page, else the Worker var. */
export async function aiModels(db: Db, env: { CLAUDE_MODEL?: string; GEMINI_MODEL?: string }): Promise<AiModels> {
  const s = await readSetting(db, "ai_models");
  const chosen = s && typeof s === "object" && typeof (s as { gemini?: unknown }).gemini === "string" ? (s as { gemini: string }).gemini : "";
  const gemini = GEMINI_MODEL_RE.test(chosen) ? chosen : env.GEMINI_MODEL ?? "";
  return { claude: env.CLAUDE_MODEL ?? "", gemini, geminiChosen: GEMINI_MODEL_RE.test(chosen) };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");
const status = (v: unknown): ModelStatus => STATUSES.find((s) => s === v) ?? "error";

/** A check result from the script made safe. */
export function cleanCheck(v: unknown, now: number): AiCheck {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const one = (x: unknown) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return { model: str(r.model, 80), status: status(r.status), detail: str(r.detail, 300) };
  };
  const models = (Array.isArray(o.models) ? o.models : []).slice(0, 80).flatMap((x): ModelTry[] => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const name = str(r.name, 80);
    return GEMINI_MODEL_RE.test(name) ? [{ name, label: str(r.label, 80) || name, status: status(r.status), detail: str(r.detail, 300) }] : [];
  });
  return { at: now, claude: one(o.claude), gemini: one(o.gemini), models };
}

export async function lastCheck(db: Db): Promise<AiCheck | null> {
  const v = await readSetting(db, "ai_check");
  return v && typeof v === "object" && typeof (v as AiCheck).at === "number" ? cleanCheck(v, (v as AiCheck).at) : null;
}

export async function saveCheck(db: Db, raw: unknown, now = Date.now()): Promise<AiCheck> {
  const check = cleanCheck(raw, now);
  await writeSetting(db, "ai_check", check, "brain", now);
  await audit(db, { actorId: "brain", action: "brain.ai_check", entity: "setting", entityId: "ai_check", detail: { claude: check.claude.status, gemini: check.gemini.status } }, now);
  return check;
}

/** Choose the Gemini model: only one the last check found working. */
export async function chooseGemini(db: Db, model: unknown, actorId: string, now = Date.now()): Promise<"ok_model" | "bad_model"> {
  if (typeof model !== "string" || !GEMINI_MODEL_RE.test(model)) return "bad_model";
  const check = await lastCheck(db);
  if (!check?.models.some((m) => m.name === model && m.status === "ok")) return "bad_model";
  await writeSetting(db, "ai_models", { gemini: model }, actorId, now);
  await audit(db, { actorId, action: "brain.gemini_model", entity: "setting", entityId: "ai_models", detail: { model } }, now);
  return "ok_model";
}

/**
 * Which listed Gemini models to try: text models only (not embeddings, speech, images or live audio), stable before
 * preview, newest first, up to BRAIN.checkModels, plus the one in use. Pure: the script and tests use it.
 */
export function modelsToTry(names: readonly string[], inUse: string): string[] {
  const text = names.filter((n) => GEMINI_MODEL_RE.test(n) && !/(embed|tts|image|imagen|live|audio|native|vision|aqa|learnlm|computer|robotics|veo)/.test(n));
  const preview = (n: string) => /(preview|exp)/.test(n);
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const sorted = [...new Set(text)].sort((a, b) => Number(preview(a)) - Number(preview(b)) || version(b) - version(a) || a.localeCompare(b));
  const pick = sorted.slice(0, BRAIN.checkModels);
  return GEMINI_MODEL_RE.test(inUse) && !pick.includes(inUse) ? [inUse, ...pick] : pick;
}

/** How a Gemini answer reads as a status (shared by the check and the runs). */
export function geminiStatus(httpStatus: number, body: string): ModelStatus {
  if (httpStatus >= 200 && httpStatus < 300) return "ok";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429) return /limit:\s*0\b|free_tier[^"]*limit[^0-9]*0\b/i.test(body) ? "not_on_plan" : "busy";
  if (httpStatus === 400 && /api key not valid|API_KEY_INVALID/i.test(body)) return "refused";
  if (httpStatus === 401 || httpStatus === 403) return "refused";
  return "error";
}

/** Google's suggested wait on a 429 ("retryDelay": "31s"), capped. */
export function retryDelayMs(body: string): number {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return Math.min(m ? Math.ceil(Number(m[1]) * 1000) : 15_000, BRAIN.geminiMaxWaitMs);
}
