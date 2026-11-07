// Finished readings kept between runs, so a failed run does not pay for them twice (owner, 7 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearReadings, loadReading, saveReading } from "../../src/lib/brain/readings.ts";
import { testBucket, testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 7);

test("a kept reading is reused only for the same version, model and PDF; a saved tree clears it", async () => {
  const db = testDb();
  const bucket = testBucket();
  const raw = { topics: [{ number: "1", title: "Motion", parent: "" }], goals: [] };
  assert.equal(await saveReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5", raw, NOW), "bad", "no syllabus PDF stored: nothing to tie it to");
  db.raw.exec(`INSERT INTO source_document (id, syllabus_id, session, year, doc_type, file_name, r2_key, sha256, size_bytes, origin, status, acquired_at)
               VALUES ('d1', '0625-2023', 'y', 2023, 'sy', '0625_y23_sy.pdf', 'k', 'sha-one', 10, 'upload', 'stored', ${NOW})`);
  assert.equal(await saveReading(db, bucket, "0625-2023", "claude", "gemini-x", raw, NOW), "bad", "model must match the provider");
  assert.equal(await saveReading(db, bucket, "0625-2023", "openai", "claude-x", raw, NOW), "bad");
  assert.equal(await saveReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5", "text", NOW), "bad");
  assert.equal(await saveReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5", raw, NOW), "ok");
  assert.deepEqual((await loadReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5"))?.raw, raw);
  assert.equal(await loadReading(db, bucket, "0625-2023", "claude", "claude-opus-5-5"), null, "another model reads afresh");
  assert.equal(await loadReading(db, bucket, "0625-2023", "gemini", "claude-sonnet-5-5"), null);
  assert.equal(await loadReading(db, bucket, "0625-2026", "claude", "claude-sonnet-5-5"), null, "another version");
  db.raw.exec(`UPDATE source_document SET sha256 = 'sha-two' WHERE id = 'd1'`);
  assert.equal(await loadReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5"), null, "a replaced PDF reads afresh");
  db.raw.exec(`UPDATE source_document SET sha256 = 'sha-one' WHERE id = 'd1'`);
  await clearReadings(bucket, "0625-2023");
  assert.equal(await loadReading(db, bucket, "0625-2023", "claude", "claude-sonnet-5-5"), null, "cleared");
});
