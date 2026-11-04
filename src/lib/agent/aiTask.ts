// One AI request from the agent: checks the run, caps the calls, builds the scope from the
// database (never from the agent's word), runs the model and checks its answer. Takes the
// database and a ModelRun, so unit tests run it on SQLite with a stub model.
import { AGENT } from "../config.ts";
import type { Db } from "../db.ts";
import { allow } from "../ratelimit.ts";
import { getRun, type RunParams } from "./runs.ts";
import { listSubjects, loadSyllabus } from "../library/catalog.ts";
import { groupCells } from "../library/checklist.ts";
import { parseCambridgeName } from "../library/names.ts";
import { loadPapers } from "../library/papers.ts";
import { checkRewrite } from "./runSummary.ts";
import {
  coverPrompt, FOLDERS_SCHEMA, foldersPrompt, NAMES_SCHEMA, namesPrompt, readFolders, readNames, readSummary, SUMMARY_SCHEMA, summaryPrompt,
  type AiScope, type ModelRun,
} from "./ai.ts";

export type AiResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: "bad_request" | "no_run" | "limit" | "ai_failed" | "ai_unavailable" };

const strings = (v: unknown, max: number, len: number): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= max && v.every((s) => typeof s === "string" && s.length <= len) ? (v as string[]) : null;

/** Files this run's checklist asks for (any status): what an AI-suggested name must be. */
export async function wantedNames(db: Db, p: RunParams): Promise<Set<string>> {
  const list = await loadSyllabus(db, p.code);
  const out = new Set<string>();
  if (!list) return out;
  for (const g of [...list.versions, ...list.sessions]) {
    for (const c of groupCells(g)) {
      const f = parseCambridgeName(c.fileName);
      if (f && p.years.includes(f.year) && p.sessions.includes(f.session)) out.add(c.fileName);
    }
  }
  return out;
}

async function scopeFor(db: Db, p: RunParams): Promise<AiScope> {
  const [subjects, { papers }] = await Promise.all([listSubjects(db), loadPapers(db, p.code)]);
  // Paper names from the newest version this run touches (falls back to any version).
  const latest = Math.max(...p.years);
  const vid = papers.filter((x) => Number(x.syllabus_id.slice(5)) <= latest).map((x) => x.syllabus_id).sort().pop();
  const own = papers.filter((x) => x.syllabus_id === vid && !x.school_assessed);
  return {
    subject: { code: p.code, label: subjects.find((s) => s.code === p.code)?.label ?? p.code, papers: own.map((x) => ({ paper: x.paper, name: x.name })) },
    years: p.years,
    sessions: p.sessions,
  };
}

export async function aiTask(db: Db, body: Record<string, unknown> | null, run: ModelRun): Promise<AiResult> {
  const jobId = body?.jobId;
  const task = body?.task;
  if (typeof jobId !== "string" || !["folders", "names", "cover", "summary"].includes(task as string)) return { ok: false, status: 400, error: "bad_request" };
  const r = await getRun(db, jobId);
  if (!r || r.status !== "running") return { ok: false, status: 409, error: "no_run" };
  if (!(await allow(db, `ai:${jobId}`, AGENT.aiCallsPerRun, 12 * 3_600_000))) return { ok: false, status: 429, error: "limit" };
  const p = JSON.parse(r.params) as RunParams;
  const scope = await scopeFor(db, p);

  try {
    if (task === "folders") {
      const names = strings(body?.names, AGENT.aiBatch, 200);
      const parent = strings(body?.path, 10, 200) ?? [];
      if (!names) return { ok: false, status: 400, error: "bad_request" };
      const reply = await run(foldersPrompt(scope, parent, names), FOLDERS_SCHEMA, AGENT.aiMaxTokens);
      return { ok: true, data: { folders: readFolders(reply, names.length) } };
    }
    if (task === "names") {
      const files = Array.isArray(body?.files) && body.files.length > 0 && body.files.length <= AGENT.aiBatch
        ? (body.files as unknown[]).map((f) => ({
            path: strings((f as { path?: unknown })?.path, 10, 200) ?? [],
            name: typeof (f as { name?: unknown })?.name === "string" ? String((f as { name: string }).name).slice(0, 200) : "",
          }))
        : null;
      if (!files || files.some((f) => !f.name)) return { ok: false, status: 400, error: "bad_request" };
      const reply = await run(namesPrompt(scope, files), NAMES_SCHEMA, AGENT.aiMaxTokens);
      return { ok: true, data: { files: readNames(reply, files.length, p.code, await wantedNames(db, p)) } };
    }
    if (task === "cover") {
      const text = typeof body?.text === "string" && body.text.trim().length >= 10 ? body.text.slice(0, 3000) : null;
      const where = typeof body?.where === "string" ? body.where.slice(0, 300) : "";
      if (!text) return { ok: false, status: 400, error: "bad_request" };
      const reply = await run(coverPrompt(scope, where, text), NAMES_SCHEMA, 600);
      return { ok: true, data: { file: readNames(reply, 1, p.code, await wantedNames(db, p))[0] } };
    }
    const draft = typeof body?.draft === "string" && body.draft.length >= 20 && body.draft.length <= 1500 ? body.draft : null;
    if (!draft) return { ok: false, status: 400, error: "bad_request" };
    const reply = await run(summaryPrompt(draft), SUMMARY_SCHEMA, 600);
    const summary = checkRewrite(draft, readSummary(reply));
    return summary ? { ok: true, data: { summary } } : { ok: false, status: 502, error: "ai_failed" };
  } catch (err) {
    // A ModelRun marks "no AI here" (local dev, binding missing) so the agent stops asking.
    if ((err as { unavailable?: boolean })?.unavailable) return { ok: false, status: 503, error: "ai_unavailable" };
    return { ok: false, status: 502, error: "ai_failed" };
  }
}
