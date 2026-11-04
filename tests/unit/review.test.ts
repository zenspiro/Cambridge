import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { claimRun, finishRun, startRun } from "../../src/lib/agent/runs.ts";
import { acceptChoices, decide, decisionKey, decisionsFor, decisionsForAgent, readReviewItems } from "../../src/lib/agent/review.ts";
import { ruleSummary } from "../../src/lib/agent/runSummary.ts";

const T = 1_800_000_000_000;
const SITE = "revisiontown-drive";
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  where: `IGCSE Physics (0625) / 2024 / May June / Scan ${n}.pdf`, why: "could not tell the document type", driveId: `DRIVEFILE${String(n).padStart(4, "0")}`, siteId: SITE, by: "rules", ...extra,
});

async function finishedRun(review: unknown[]) {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "dry" as const };
  const id = (await startRun(db, p, "platform-admin", T))!;
  await claimRun(db, id, T + 1);
  await finishRun(db, id, true, JSON.stringify({ review }), null, T + 2);
  return { db, id };
}

test("review items: objects are checked, old text entries are shown but not decidable", () => {
  const items = readReviewItems([
    "Physics / 2024 / notes.pdf: the AI was not sure",
    item(1, { suggest: "0625_s24_qp_43.pdf" }),
    { where: "x", why: "y", driveId: "bad id!", siteId: SITE },
    item(2, { suggest: "not a name" }),
  ]);
  assert.deepEqual(items[0], { where: "Physics / 2024 / notes.pdf", why: "the AI was not sure" });
  assert.equal(items[1]!.driveId, "DRIVEFILE0001");
  assert.equal(items[1]!.suggest, "0625_s24_qp_43.pdf");
  assert.equal(items[2]!.driveId, undefined, "odd Drive ids are dropped");
  assert.equal(items[3]!.suggest, undefined, "suggestions must be Cambridge names");
  assert.deepEqual(readReviewItems("nope"), []);
});

test("accept: only a missing file the run looks for, one source file per name", async () => {
  const { db, id } = await finishedRun([item(1), item(2), "old / text.pdf: unsure"]);
  const choices = await acceptChoices(db, { code: "0625", years: [2024], sessions: ["s"], mode: "dry" });
  assert.ok(choices.includes("0625_s24_qp_22.pdf") && choices.every((n) => n.includes("_s24_")), "choices are this run's files");
  const go = (i: number, action: string, name?: string) => decide(db, { runId: id, index: i, action, name, actorId: "platform-admin" }, T + 10);
  assert.equal(await go(0, "accept"), "bad", "a name is needed");
  assert.equal(await go(0, "accept", "0625_s23_qp_22.pdf"), "bad", "outside the run");
  assert.equal(await go(0, "accept", "0478_s24_qp_12.pdf"), "bad", "another subject");
  assert.equal(await go(2, "accept", "0625_s24_qp_22.pdf"), "bad", "old text entries cannot be decided");
  assert.equal(await go(9, "reject"), "bad", "no such item");
  assert.equal(await go(0, "delete"), "bad");
  assert.equal(await go(0, "accept", "0625_s24_qp_22.pdf"), "ok_accepted");
  assert.equal(await go(1, "accept", "0625_s24_qp_22.pdf"), "taken", "the same name for a second file");
  assert.equal(await go(0, "accept", "0625_s24_qp_22.pdf"), "ok_accepted", "the same file may be accepted again");
  assert.equal(await go(1, "reject"), "ok_rejected");

  const d = await decisionsFor(db, readReviewItems([item(1), item(2)]));
  assert.equal(d.get(decisionKey(SITE, "DRIVEFILE0001"))?.fileName, "0625_s24_qp_22.pdf");
  assert.equal(d.get(decisionKey(SITE, "DRIVEFILE0002"))?.decision, "reject");
  const forAgent = await decisionsForAgent(db);
  assert.deepEqual(forAgent.map((x) => `${x.id}:${x.decision}:${x.name}`).sort(), ["DRIVEFILE0001:accept:0625_s24_qp_22.pdf", "DRIVEFILE0002:reject:null"]);

  assert.equal(await go(0, "undo"), "ok_undone");
  assert.equal((await decisionsForAgent(db)).length, 1);
  const audits = await db.prepare(`SELECT action FROM audit_log WHERE action LIKE 'review.%' ORDER BY at, rowid`).bind().all<{ action: string }>();
  assert.deepEqual(audits.results.map((a) => a.action), ["review.accept", "review.accept", "review.reject", "review.undo"]);
});

test("decisions wait for the run to finish and need a Drive source", async () => {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "dry" as const };
  const id = (await startRun(db, p, "platform-admin", T))!;
  assert.equal(await decide(db, { runId: id, index: 0, action: "reject", actorId: "platform-admin" }), "gone", "a waiting run");
  assert.equal(await decide(db, { runId: "nope", index: 0, action: "reject", actorId: "platform-admin" }), "gone");
  const other = await finishedRun([item(1, { siteId: "cambridge-official" })]);
  assert.equal(await decide(other.db, { runId: other.id, index: 0, action: "reject", actorId: "platform-admin" }), "gone", "not a Drive source");
});

test("summary mentions files the owner rejected earlier", () => {
  const text = ruleSummary({
    subject: "IGCSE Physics (0625)", mode: "dry", years: [2024], sessions: ["June"], allSessions: false, websitePages: 0,
    driveFolders: [], driveOtherSubjects: 0, found: 0, have: 0, outside: 0, stored: 0, failed: 0, notNeeded: 0, review: 0, rejected: 3, notNamed: 0, maxFiles: 400,
  });
  assert.match(text, /3 files you rejected earlier skipped/);
});
