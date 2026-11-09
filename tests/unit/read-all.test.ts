import { test } from "node:test";
import assert from "node:assert/strict";
import { testBucket, testDb } from "./helpers/d1.ts";
import { loadSyllabus } from "../../src/lib/library/catalog.ts";
import { loadPapers } from "../../src/lib/library/papers.ts";
import { buildSubjectMap } from "../../src/lib/library/map.ts";
import { storeDocument } from "../../src/lib/library/store.ts";
import { filterQuery, filterWords, hasTiers, inTier, planBatch, ragOf, readFilter, readStates, rowDocIds, stateOf } from "../../src/lib/brain/readAll.ts";
import { activeBrainRun, batchPlace, claimBrainRun, nextBatchPaper, runState, startBatchRun } from "../../src/lib/brain/runs.ts";
import { describeRun } from "../../src/lib/adminStatus.ts";
import { BRAIN, SESSION_LABELS } from "../../src/lib/config.ts";

const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.4\n${s}`);
const YEARS = [2022, 2023, 2024, 2025, 2026];

async function library() {
  const db = testDb();
  const bucket = testBucket();
  // Nov 2025 variant 2 (essential): Paper 1 qp (Core), Paper 2 qp and ms (Extended), Paper 4 ms (Extended), Paper 5 qp (both).
  for (const f of ["0625_w25_qp_12.pdf", "0625_w25_qp_22.pdf", "0625_w25_ms_22.pdf", "0625_w25_ms_42.pdf", "0625_w25_qp_52.pdf", "0625_s25_qp_22.pdf", "0625_w25_qp_21.pdf"]) {
    await storeDocument(db, bucket, { fileName: f, bytes: pdf(f), actorId: "a", origin: "upload" });
  }
  const id = async (f: string) => (await db.prepare(`SELECT id FROM source_document WHERE file_name = ?1`).bind(f).first<{ id: string }>())!.id;
  return { db, bucket, id };
}

test("read all: Core or Extended, a month and a year; essential variants only; question paper before its mark scheme", async () => {
  const { db, id } = await library();
  const list = (await loadSyllabus(db, "0625"))!;
  const { papers } = await loadPapers(db, "0625");
  assert.ok(hasTiers(papers));
  const ext = planBatch(list, papers, { tier: "extended", session: "w", year: 2025 }, new Map());
  assert.deepEqual(ext.toRead.map((d) => d.fileName), ["0625_w25_qp_22.pdf", "0625_w25_ms_22.pdf", "0625_w25_ms_42.pdf", "0625_w25_qp_52.pdf"], "variant 1 and other months left out; practicals count for both");
  assert.ok(ext.missing > 0, "files not in the library are counted");
  const core = planBatch(list, papers, { tier: "core", session: "w", year: 2025 }, new Map());
  assert.deepEqual(core.toRead.map((d) => d.fileName), ["0625_w25_qp_12.pdf", "0625_w25_qp_52.pdf"]);
  // Only what is not read yet.
  const state = new Map([[await id("0625_w25_qp_22.pdf"), "ready" as const], [await id("0625_w25_ms_22.pdf"), "flagged" as const]]);
  const again = planBatch(list, papers, { tier: "extended", session: "w", year: 2025 }, state);
  assert.deepEqual(again.toRead.map((d) => d.fileName), ["0625_w25_ms_42.pdf", "0625_w25_qp_52.pdf"]);
  assert.equal(again.read, 2);
  // Every month and year: newest session first.
  const all = planBatch(list, papers, { tier: "extended", session: null, year: null }, new Map());
  assert.equal(all.toRead.at(-1)!.fileName, "0625_s25_qp_22.pdf");
  // One run reads at most BRAIN.maxBatchPapers; the rest are counted.
  const two = planBatch(list, papers, { tier: "extended", session: null, year: null }, new Map(), 2);
  assert.deepEqual([two.toRead.length, two.over], [2, 3]);
  assert.ok(BRAIN.maxBatchPapers >= 10);
});

test("read all: tiers, choices from a query, and words", () => {
  assert.ok(inTier("core", "core") && inTier("all", "extended") && !inTier("extended", "core") && inTier(null, "any") && !inTier(null, "core"));
  assert.deepEqual(readFilter((k) => ({ ra: "extended", ras: "w", ray: "2025" })[k], YEARS), { tier: "extended", session: "w", year: 2025 });
  assert.deepEqual(readFilter((k) => ({ ra: "core", ras: "y", ray: "1999" })[k], YEARS), { tier: "core", session: null, year: null }, "unknown month and year are every one");
  assert.equal(readFilter((k) => ({ ra: "drop" })[k], YEARS), null);
  assert.equal(filterQuery({ tier: "extended", session: "w", year: 2025 }), "ra=extended&ras=w&ray=2025");
  assert.equal(filterWords({ tier: "extended", session: "w", year: 2025 }, SESSION_LABELS), "Extended papers, Nov 2025");
  assert.equal(filterWords({ tier: "core", session: "w", year: null }, SESSION_LABELS), "Core papers, Nov every year");
  assert.equal(filterWords({ tier: "any", session: null, year: null }, SESSION_LABELS), "All papers, every session");
});

test("reading status: red, amber, green per session row; none without stored papers", async () => {
  assert.equal(ragOf([], new Map()), null);
  assert.equal(ragOf(["a", "b"], new Map()), "red");
  assert.equal(ragOf(["a", "b"], new Map([["a", "ready"]])), "amber");
  assert.equal(ragOf(["a"], new Map([["a", "flagged"]])), "amber");
  assert.equal(ragOf(["a", "b"], new Map([["a", "ready"], ["b", "ready"]])), "green");
  assert.equal(stateOf(null, null, [], [], new Set()), "unread");
  assert.equal(stateOf(1, null, ["f1"], ["f1"], new Set()), "ready", "dismissed");
  assert.equal(stateOf(1, null, ["f1", "f2"], ["f1"], new Set(["f2"])), "ready", "a subject rule");
  assert.equal(stateOf(1, null, ["f1"], [], new Set()), "flagged");
  assert.equal(stateOf(1, 5, ["f1"], [], new Set()), "ready", "marked ready anyway");

  const { db, id } = await library();
  const qp = await id("0625_w25_qp_22.pdf");
  await db.prepare(`INSERT INTO paper_read (doc_id, items, flags, read_at, updated_at) VALUES (?1, 3, '[]', 1, 1)`).bind(qp).run();
  const states = await readStates(db, "0625");
  assert.equal(states.get(qp), "ready");
  const list = (await loadSyllabus(db, "0625"))!;
  const { papers } = await loadPapers(db, "0625");
  const row = buildSubjectMap(list, papers).flatMap((v) => v.rows).find((r) => r.label === "Nov 2025")!;
  assert.equal(rowDocIds(row.cells).length, 5, "only question papers and mark schemes count");
  assert.equal(ragOf(rowDocIds(row.cells), states), "amber");
});

test("a Read all batch: one run reads its papers in turn; one read meanwhile is skipped; the last closes the run", async () => {
  const { db, id } = await library();
  const docs = [await id("0625_w25_qp_22.pdf"), await id("0625_w25_ms_22.pdf"), await id("0625_w25_ms_42.pdf")];
  const run = (await startBatchRun(db, docs, "0625 Extended papers, Nov 2025", "platform-admin", 1000))!;
  assert.ok(run);
  assert.equal(await startBatchRun(db, docs, "again", "platform-admin", 1001), null, "one brain run at a time");
  const p = await claimBrainRun(db, run, null, 1002);
  assert.equal(p?.task === "paper" && p.docId, docs[0]);
  assert.deepEqual(batchPlace(p), { at: 1, of: 3 });
  const job = (await db.prepare(`SELECT status, params, step FROM job WHERE id = ?1`).bind(run).first<{ status: string; params: string; step: string | null }>())!;
  assert.equal(describeRun({ id: run, type: "brain", ...job })?.label, "Read all: paper 1 of 3");
  // Paper 2 was read by another run meanwhile: skipped.
  await db.prepare(`INSERT INTO paper_read (doc_id, items, read_at, updated_at) VALUES (?1, 3, 5, 5) ON CONFLICT (doc_id) DO UPDATE SET read_at = 5`).bind(docs[1]).run();
  assert.equal(await nextBatchPaper(db, run, 2000), docs[2]);
  const now = await activeBrainRun(db, run);
  assert.equal(now?.task === "paper" && now.docId, docs[2]);
  assert.equal((await db.prepare(`SELECT job_id FROM paper_read WHERE doc_id = ?1`).bind(docs[2]).first<{ job_id: string }>())?.job_id, run, "the paper belongs to the run, so its reading may be saved");
  assert.equal(await nextBatchPaper(db, run, 3000), null);
  assert.equal((await runState(db, run, 3000))?.status, "succeeded");
});

test("a batch list from the database is made safe", async () => {
  const { db, id } = await library();
  const a = await id("0625_w25_qp_22.pdf");
  await db.prepare(`INSERT INTO job (id, type, status, params, created_by, created_at) VALUES ('job-batch-bad-1', 'brain', 'running', ?1, 'a', 1)`)
    .bind(JSON.stringify({ task: "paper", docId: a, scope: { items: [], figures: [] }, batch: { docs: [a, "../x", 7], label: 3 } })).run();
  const p = await activeBrainRun(db, "job-batch-bad-1");
  assert.deepEqual(p?.task === "paper" && p.batch, { docs: [a], label: "" });
});
