import { test } from "node:test";
import assert from "node:assert/strict";
import { activityWords, describeRun } from "../../src/lib/adminStatus.ts";

test("runs in progress are described in words with a link to watch them", () => {
  const agent = describeRun({ id: "j1", type: "agent", status: "running", params: JSON.stringify({ code: "0625", mode: "download" }), step: "Reading page 2" });
  assert.deepEqual(agent, { id: "j1", label: "Agent download 0625", href: "/admin/agent/runs/j1", step: "Reading page 2", queued: false });
  assert.equal(describeRun({ id: "j2", type: "brain", status: "queued", params: JSON.stringify({ task: "paper", docId: "d 1" }), step: null })!.href, "/admin/library/review/d%201");
  assert.equal(describeRun({ id: "j3", type: "brain", status: "running", params: JSON.stringify({ task: "check" }), step: null })!.label, "AI setup check");
  assert.equal(describeRun({ id: "j4", type: "brain", status: "running", params: "not json", step: null })!.label, "Drafting a topic tree");
  assert.equal(describeRun({ id: "j5", type: "source_upload", status: "running", params: "{}", step: null }), null);
});

test("the activity list uses words, never internal codes", () => {
  assert.equal(activityWords("admin.login"), "Signed in");
  assert.equal(activityWords("family.remove"), "A parent removed a child from the family");
  assert.equal(activityWords("paper.something_new"), "Paper review: other change");
  assert.equal(activityWords("weird"), "Other: other change");
  assert.equal(activityWords("constructor"), "Other: other change");
});

test("Needs you: a stop clears itself when the same thing later succeeds, and can be cleared and brought back by hand", async () => {
  const { testDb, testBucket } = await import("./helpers/d1.ts");
  const { storeDocument } = await import("../../src/lib/library/store.ts");
  const { failedRuns, clearNeed, papersToReview, recentlyCleared, runKeys } = await import("../../src/lib/adminStatus.ts");
  const db = testDb();
  const now = 10 * 86_400_000;
  const job = (id: string, type: string, status: string, params: object, at: number) =>
    db.prepare(`INSERT INTO job (id, type, status, params, created_by, created_at, finished_at, error_ref) VALUES (?1, ?2, ?3, ?4, 'a', ?5, ?5, 'timeout')`).bind(id, type, status, JSON.stringify(params), at).run();
  assert.deepEqual(runKeys(JSON.stringify({ code: "0625", mode: "dry" }), "agent"), ["agent:0625:dry"]);
  assert.deepEqual(runKeys(JSON.stringify({ task: "paper", docId: "d1", batch: { docs: ["d1", "d2"] } }), "brain"), ["batch:d1,d2", "paper:d1", "paper:d2"]);
  assert.deepEqual(runKeys("not json", "brain"), []);
  await job("agent-fail-1", "agent", "failed", { code: "0625", mode: "dry" }, now - 3000);
  await job("agent-ok-1", "agent", "succeeded", { code: "0625", mode: "dry" }, now - 2000);
  await job("agent-fail-2", "agent", "failed", { code: "0620", mode: "download" }, now - 1000);
  await job("tree-fail-1", "brain", "failed", { task: "topics", syllabusId: "0625-2023" }, now - 900);
  await job("old-fail-1", "agent", "failed", { code: "0610", mode: "dry" }, now - 8 * 86_400_000);
  let f = await failedRuns(db, now);
  assert.deepEqual(f.list.map((r) => r.id), ["tree-fail-1", "agent-fail-2"], "settled by a later success, older than 7 days left out");
  assert.equal(await clearNeed(db, "run", "agent-fail-2", false, now), 1);
  f = await failedRuns(db, now);
  assert.deepEqual(f.list.map((r) => r.id), ["tree-fail-1"]);
  assert.deepEqual((await recentlyCleared(db, now)).map((c) => c.id), ["agent-fail-2"]);
  assert.equal(await clearNeed(db, "run", "agent-fail-2", true, now), 1, "undo");
  assert.equal((await failedRuns(db, now)).total, 2);
  assert.equal(await clearNeed(db, "run", "all", false, now), 2);
  assert.equal((await failedRuns(db, now)).total, 0);
  assert.equal(await clearNeed(db, "run", "agent-ok-1", false, now), 0, "only stopped runs");

  // A paper with flags: cleared, then back when it is read again.
  await storeDocument(db, testBucket(), { fileName: "0625_s24_qp_42.pdf", bytes: new TextEncoder().encode("%PDF-1.4\nx"), actorId: "a", origin: "upload" });
  const doc = (await db.prepare(`SELECT id FROM source_document WHERE file_name = '0625_s24_qp_42.pdf'`).bind().first<{ id: string }>())!.id;
  await db.prepare(`INSERT INTO paper_read (doc_id, items, flags, read_at, updated_at) VALUES (?1, 3, '[{"fingerprint":"f1"}]', ?2, ?2)`).bind(doc, now - 500).run();
  assert.equal((await papersToReview(db)).total, 1);
  await clearNeed(db, "paper", doc, false, now);
  assert.equal((await papersToReview(db)).total, 0);
  await db.prepare(`UPDATE paper_read SET read_at = ?2 WHERE doc_id = ?1`).bind(doc, now + 100).run();
  assert.equal((await papersToReview(db)).total, 1, "read again: back on Home");
  // A stopped paper run is settled once the paper is read after it.
  await job("paper-fail-1", "brain", "failed", { task: "paper", docId: doc, scope: { items: [], figures: [] } }, now);
  assert.equal((await failedRuns(db, now + 200)).total, 0);
});

test("storage: database size from D1, papers from our rows, app files by listing, kept for an hour", async () => {
  const { testDb } = await import("./helpers/d1.ts");
  const { bucketBytes, cleanStat, dbBytes, sizeWords, storageStat } = await import("../../src/lib/storage.ts");
  const db = testDb();
  assert.equal(await dbBytes(db), null, "node:sqlite reports no size");
  assert.equal(await dbBytes({ prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { size_after: 12_288 } }) }) }) }), 12_288);
  let calls = 0;
  const pages = [{ objects: [{ size: 100 }, { size: 50 }], truncated: true, cursor: "c1" }, { objects: [{ size: 25 }], truncated: false }];
  const bucket = { list: async () => pages[calls++]! };
  assert.deepEqual(await bucketBytes(bucket), { bytes: 175, count: 3, partial: false });
  calls = 0;
  assert.deepEqual(await bucketBytes(bucket, 1), { bytes: 150, count: 2, partial: true }, "stops after the last call allowed");
  calls = 0;
  const first = await storageStat(db, bucket, 1000);
  assert.deepEqual([first.files.bytes, first.papers.count], [175, 0]);
  calls = 0;
  const again = await storageStat(db, { list: async () => { calls++; return { objects: [], truncated: false }; } }, 2000);
  assert.equal(calls, 0, "within the hour the kept count is used");
  assert.equal(again.files.bytes, 175);
  assert.equal(cleanStat({ at: "x" }), null);
  assert.equal(sizeWords(1_234_000), "1.2 MB");
  assert.equal(sizeWords(5_000_000_000), "5.00 GB");
});
