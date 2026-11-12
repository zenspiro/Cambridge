import { test } from "node:test";
import assert from "node:assert/strict";
import { testBucket, testDb } from "./helpers/d1.ts";
import { storeDocument } from "../../src/lib/library/store.ts";
import { activeBrainRun, batchAdvance, claimBrainRun, failBrainRun, nextBatchPaper, runState, SKIP_STREAK_STOP, startBatchRun, startPaperRun } from "../../src/lib/brain/runs.ts";
import { askWords, launchAsk, readQueue, startQueued, unqueue } from "../../src/lib/brain/queue.ts";
import type { AppEnv } from "../../src/lib/env.ts";

const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.4\n${s}`);
const env = {} as AppEnv;
const sent: string[] = [];
const dispatch = async (_e: AppEnv, jobId: string) => {
  sent.push(jobId);
  return { ok: true as const };
};

async function library() {
  const db = testDb();
  const bucket = testBucket();
  for (const f of ["0625_w25_qp_22.pdf", "0625_w25_ms_22.pdf", "0625_w25_qp_42.pdf", "0625_m25_qp_42.pdf", "0625_m25_ms_42.pdf"]) {
    await storeDocument(db, bucket, { fileName: f, bytes: pdf(f), actorId: "a", origin: "upload" });
  }
  const id = async (f: string) => (await db.prepare(`SELECT id FROM source_document WHERE file_name = ?1`).bind(f).first<{ id: string }>())!.id;
  return { db, bucket, id };
}

test("Gemini down in a batch: the paper is skipped, tried once more at the end, then given up; several in a row stop the run", () => {
  const b = { docs: ["a", "b", "c"], label: "0625 x" };
  const s1 = batchAdvance(b, "a", true);
  assert.deepEqual([s1.candidates, s1.batch.skipped, s1.retryPass, s1.stop], [["b", "c"], ["a"], false, false]);
  const s2 = batchAdvance(s1.batch, "b", false);
  assert.equal(s2.batch.streak, 0, "a paper read clears the streak");
  const s3 = batchAdvance(s2.batch, "c", false);
  assert.deepEqual([s3.candidates, s3.retryPass, s3.batch.again], [["a"], true, true], "the skipped paper gets one more try at the end");
  const s4 = batchAdvance(s3.batch, "a", true);
  assert.deepEqual([s4.candidates, s4.batch.failed, s4.stop], [[], ["a"], false], "skipped twice: given up, the run ends");
  // Gemini out for good: the run stops instead of waiting on every paper.
  let x = batchAdvance({ docs: ["a", "b", "c", "d"], label: "" }, "a", true);
  for (const d of ["b", "c"].slice(0, SKIP_STREAK_STOP - 1)) x = batchAdvance(x.batch, d, true);
  assert.equal(x.stop, true);
  // No skips: the list in order, then done.
  assert.deepEqual(batchAdvance(b, "c", false), { batch: { ...b, streak: 0 }, candidates: [], retryPass: false, stop: false });
});

test("a skipped paper is read again at the end of the run, and the run keeps the list of papers not read", async () => {
  const { db, id } = await library();
  const docs = [await id("0625_w25_qp_22.pdf"), await id("0625_w25_ms_22.pdf")];
  const run = (await startBatchRun(db, docs, "0625 test", "a", 1000))!;
  await claimBrainRun(db, run, null, 1001);
  const step = batchAdvance((await activeBrainRun(db, run) as { batch: { docs: string[]; label: string } }).batch, docs[0]!, true);
  assert.equal(await nextBatchPaper(db, run, 1100, step), docs[1]);
  const p = await activeBrainRun(db, run);
  assert.deepEqual(p?.task === "paper" && p.batch?.skipped, [docs[0]], "kept with the run");
  const back = batchAdvance((p as { batch: { docs: string[]; label: string } }).batch, docs[1]!, false);
  assert.equal(await nextBatchPaper(db, run, 1200, back), docs[0], "tried again");
  const last = batchAdvance(((await activeBrainRun(db, run)) as { batch: { docs: string[]; label: string } }).batch, docs[0]!, true);
  assert.equal(await nextBatchPaper(db, run, 1300, last), null);
  const done = await runState(db, run, 1300);
  assert.equal(done?.status, "succeeded");
  assert.deepEqual(done?.params?.task === "paper" && done.params.batch?.failed, [docs[0]], "the paper not read is named");
});

test("the run queue: a batch asked for while a run goes on waits, then starts on its own when that run ends", async () => {
  const { db } = await library();
  sent.length = 0;
  // A one-paper run is going on.
  const solo = (await startPaperRun(db, (await db.prepare(`SELECT id FROM source_document LIMIT 1`).bind().first<{ id: string }>())!.id, { items: [], figures: [] }, "a", 1000))!;
  assert.equal(await launchAsk(db, env, { kind: "benchmark", code: "0625" }, "a", dispatch, 1100), "ok_queued");
  assert.equal(await launchAsk(db, env, { kind: "benchmark", code: "0625" }, "a", dispatch, 1101), "queue_dupe");
  assert.equal(await launchAsk(db, env, { kind: "check", code: "0625" }, "a", dispatch, 1102), "check_none", "nothing read: nothing to queue");
  assert.equal(await launchAsk(db, env, { kind: "read", code: "0625", filter: { tier: "extended", session: "w", year: 2025 } }, "a", dispatch, 1103), "ok_queued");
  assert.deepEqual((await readQueue(db)).map(askWords), ["0625 benchmark papers", "0625 Extended papers, Nov 2025"]);
  assert.equal(sent.length, 0, "nothing started while the run goes on");
  assert.equal(await startQueued(db, env, { dispatch, now: 1200 }), "running");
  // The run ends: the first ask starts, the second waits for it.
  await db.prepare(`UPDATE job SET status = 'succeeded', finished_at = 1300 WHERE id = ?1`).bind(solo).run();
  assert.equal(await startQueued(db, env, { dispatch, now: 1300 }), "ok_batch");
  assert.equal(sent.length, 1);
  const q = await readQueue(db);
  assert.deepEqual(q.map(askWords), ["0625 Extended papers, Nov 2025"]);
  const started = await runState(db, sent[0]!, 1300);
  assert.equal(started?.params?.task === "paper" && started.params.batch?.label, "0625 benchmark papers");
  // That run stops because Gemini is down: the queue waits instead of starting a run that would stop too.
  await failBrainRun(db, sent[0]!, "gemini_down", 1400);
  assert.equal(await startQueued(db, env, { lastStop: "gemini_down", dispatch, now: 1400 }), "gemini_down");
  assert.equal((await readQueue(db))[0]?.held, "gemini_down");
  assert.equal(await startQueued(db, env, { dispatch, now: 1500 }), "gemini_down", "still held");
  // Start now, or on its own after a while.
  assert.equal(await startQueued(db, env, { dispatch, now: 1400 + 31 * 60_000 }), "ok_batch");
  assert.equal((await readQueue(db)).length, 0);
  assert.equal(sent.length, 2);
});

test("the run queue: Remove takes one ask out; an ask with nothing to read is dropped when its turn comes", async () => {
  const { db, id } = await library();
  sent.length = 0;
  const solo = (await startPaperRun(db, await id("0625_w25_qp_22.pdf"), { items: [], figures: [] }, "a", 1000))!;
  await launchAsk(db, env, { kind: "benchmark", code: "0625" }, "a", dispatch, 1100);
  await launchAsk(db, env, { kind: "benchmark", code: "0625", again: true }, "a", dispatch, 1101);
  const [first, second] = await readQueue(db);
  assert.equal(askWords(second!), "0625 benchmark papers again, for the score");
  assert.equal(await unqueue(db, second!.id, "a", 1200), true);
  assert.equal(await unqueue(db, "nope", "a", 1200), false);
  // Every benchmark paper gets read meanwhile: nothing left, so the ask is dropped.
  for (const f of ["0625_w25_qp_42.pdf", "0625_m25_qp_42.pdf", "0625_m25_ms_42.pdf"]) {
    await db.prepare(`INSERT INTO paper_read (doc_id, items, flags, read_at, updated_at) VALUES (?1, 3, '[]', 1, 1)`).bind(await id(f)).run();
  }
  await db.prepare(`UPDATE job SET status = 'succeeded', finished_at = 1300 WHERE id = ?1`).bind(solo).run();
  assert.equal(await startQueued(db, env, { dispatch, now: 1300 }), "empty");
  assert.equal(sent.length, 0);
  assert.ok(first);
  // Reading them again for the score takes every stored benchmark paper, read or not.
  assert.equal(await launchAsk(db, env, { kind: "benchmark", code: "0625", again: true }, "a", dispatch, 1400), "ok_batch");
  const run = await runState(db, sent[0]!, 1400);
  assert.equal(run?.params?.task === "paper" && run.params.shadow, true);
  assert.equal(run?.params?.task === "paper" && run.params.batch?.docs.length, 3);
});
