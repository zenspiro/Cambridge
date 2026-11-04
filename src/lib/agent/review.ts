// "Needs your eye": files the agent found in a source but could not place. On the run page the
// owner accepts one (choosing which checklist file it is) or rejects it; later runs read the
// decisions (`/api/agent/job`), so an accepted file is fetched under that name and a rejected one
// is skipped. The item is always read from the run's own report by its position, never from the
// form, so a decision can only be about a file the agent really reported.
import { audit } from "../auth/session.ts";
import { randomId } from "../auth/crypto.ts";
import type { Db } from "../db.ts";
import { parseCambridgeName } from "../library/names.ts";
import { STORED_NAMES } from "../library/queries.ts";
import { wantedNames } from "./aiTask.ts";
import { readReport } from "./labels.ts";
import { getRun, type RunParams } from "./runs.ts";

export type ReviewItem = {
  /** Folder path and file name, as the agent saw them. */
  where: string;
  why: string;
  /** Google Drive file id and its source; absent on reports from before decisions existed. */
  driveId?: string;
  siteId?: string;
  /** A Cambridge name the AI suggested (outside the run, or not asked for). */
  suggest?: string;
  by?: "ai" | "rules";
};

export type Decision = { decision: "accept" | "reject"; fileName: string | null; label: string; decidedAt: number };

export const MAX_REVIEW = 200;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
const SITE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Report entries as items. Old reports hold "path / file: reason" strings: shown, not decidable. */
export function readReviewItems(v: unknown): ReviewItem[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_REVIEW).map((x): ReviewItem => {
    if (typeof x === "string") {
      const cut = x.lastIndexOf(": ");
      return cut > 0 ? { where: x.slice(0, cut), why: x.slice(cut + 2) } : { where: x, why: "" };
    }
    const o = (x ?? {}) as Record<string, unknown>;
    const str = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).slice(0, max) : "");
    const driveId = str("driveId", 100);
    const siteId = str("siteId", 64);
    const suggest = str("suggest", 40);
    return {
      where: str("where", 600),
      why: str("why", 200),
      ...(DRIVE_ID.test(driveId) && SITE_ID.test(siteId) ? { driveId, siteId } : {}),
      ...(parseCambridgeName(suggest) ? { suggest } : {}),
      ...(o.by === "ai" || o.by === "rules" ? { by: o.by } : {}),
    };
  });
}

export const decisionKey = (siteId: string, id: string) => `${siteId}:${id}`;

/** Decisions for the given items, keyed by decisionKey. */
export async function decisionsFor(db: Db, items: ReviewItem[]): Promise<Map<string, Decision>> {
  const out = new Map<string, Decision>();
  const keys = items.filter((i) => i.driveId && i.siteId);
  if (!keys.length) return out;
  const { results } = await db
    .prepare(`SELECT site_id, item_key, decision, file_name, label, decided_at FROM review_decision
              WHERE item_key IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(keys.map((k) => k.driveId)))
    .all<{ site_id: string; item_key: string; decision: "accept" | "reject"; file_name: string | null; label: string; decided_at: number }>();
  for (const r of results) out.set(decisionKey(r.site_id, r.item_key), { decision: r.decision, fileName: r.file_name, label: r.label, decidedAt: r.decided_at });
  return out;
}

/** Every decision, for the agent (it applies them while reading its sources). */
export async function decisionsForAgent(db: Db): Promise<{ siteId: string; id: string; decision: "accept" | "reject"; name: string | null }[]> {
  const { results } = await db
    .prepare(`SELECT site_id, item_key, decision, file_name FROM review_decision ORDER BY decided_at DESC LIMIT 5000`)
    .bind()
    .all<{ site_id: string; item_key: string; decision: "accept" | "reject"; file_name: string | null }>();
  return results.map((r) => ({ siteId: r.site_id, id: r.item_key, decision: r.decision, name: r.file_name }));
}

/** Files a run may accept an item as: what its checklist asks for and the library does not hold. */
export async function acceptChoices(db: Db, p: RunParams): Promise<string[]> {
  const [wanted, { results: stored }] = await Promise.all([wantedNames(db, p), db.prepare(STORED_NAMES).bind(p.code).all<{ file_name: string }>()]);
  const have = new Set(stored.map((s) => s.file_name));
  return [...wanted].filter((n) => !have.has(n)).sort();
}

export type DecideResult = "ok_accepted" | "ok_rejected" | "ok_undone" | "bad" | "taken" | "stored" | "gone";

/**
 * Records one decision. `index` points into the run's report; `name` is needed to accept and
 * must be a file the run's checklist asks for, not stored yet and not chosen for another file.
 */
export async function decide(
  db: Db,
  input: { runId: string; index: number; action: string; name?: string | null; actorId: string },
  now = Date.now(),
): Promise<DecideResult> {
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= MAX_REVIEW) return "bad";
  if (!["accept", "reject", "undo"].includes(input.action)) return "bad";
  const run = await getRun(db, input.runId);
  if (!run || ["queued", "running"].includes(run.status)) return "gone";
  const item = readReviewItems(readReport(run.result).review)[input.index];
  if (!item?.driveId || !item.siteId) return "bad";
  const site = await db.prepare(`SELECT id FROM source_site WHERE id = ?1 AND kind = 'gdrive'`).bind(item.siteId).first<{ id: string }>();
  if (!site) return "gone";
  const detail = { run: input.runId, file: item.where.slice(-120) };

  if (input.action === "undo") {
    await db.prepare(`DELETE FROM review_decision WHERE site_id = ?1 AND item_key = ?2`).bind(item.siteId, item.driveId).run();
    await audit(db, { actorId: input.actorId, action: "review.undo", entity: "review_decision", entityId: item.driveId, detail }, now);
    return "ok_undone";
  }

  let name: string | null = null;
  if (input.action === "accept") {
    const p = JSON.parse(run.params) as RunParams;
    name = typeof input.name === "string" ? input.name : "";
    if (!parseCambridgeName(name) || !(await wantedNames(db, p)).has(name)) return "bad";
    const { results: stored } = await db.prepare(STORED_NAMES).bind(p.code).all<{ file_name: string }>();
    if (stored.some((s) => s.file_name === name)) return "stored";
    const other = await db
      .prepare(`SELECT item_key FROM review_decision WHERE file_name = ?1 AND NOT (site_id = ?2 AND item_key = ?3)`)
      .bind(name, item.siteId, item.driveId)
      .first<{ item_key: string }>();
    if (other) return "taken";
  }
  await db
    .prepare(`INSERT INTO review_decision (id, site_id, item_key, decision, file_name, label, run_id, decided_by, decided_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
              ON CONFLICT (site_id, item_key) DO UPDATE SET decision = excluded.decision, file_name = excluded.file_name,
                label = excluded.label, run_id = excluded.run_id, decided_by = excluded.decided_by, decided_at = excluded.decided_at`)
    .bind(randomId(), item.siteId, item.driveId, input.action, name, item.where.slice(0, 600), input.runId, input.actorId, now)
    .run();
  await audit(db, { actorId: input.actorId, action: `review.${input.action}`, entity: "review_decision", entityId: item.driveId, detail: name ? { ...detail, name } : detail }, now);
  return input.action === "accept" ? "ok_accepted" : "ok_rejected";
}
