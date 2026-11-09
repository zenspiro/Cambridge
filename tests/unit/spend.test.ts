// AI usage, spend and the monthly cap (owner request 6 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capCheck, cleanPrices, cleanUsage, costUsd, estimatePaper, estimateTopics, readerChoices, monthBounds, parseAmount, readCap, readPrices, recentRuns, recordSpend,
  saveCap, savePrice, spendBetween, summarise, taskHistory, topicsCostCheck, usdWords,
} from "../../src/lib/brain/spend.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 6, 12);

test("usage reports are checked: provider and model must match, numbers whole and capped", () => {
  assert.deepEqual(cleanUsage({ provider: "claude", model: "claude-sonnet-5-5", calls: 1, pages: 61, tokensIn: 150_000, tokensOut: 20_000 }),
    { provider: "claude", model: "claude-sonnet-5-5", calls: 1, pages: 61, tokensIn: 150_000, tokensOut: 20_000 });
  assert.equal(cleanUsage({ provider: "claude", model: "gemini-3.5-flash", calls: 1, tokensIn: 1, tokensOut: 1 }), null, "wrong provider");
  assert.equal(cleanUsage({ provider: "openai", model: "claude-x", calls: 1, tokensIn: 1, tokensOut: 1 }), null);
  assert.equal(cleanUsage({ provider: "gemini", model: "gemini-a", calls: 0, tokensIn: 1, tokensOut: 1 }), null, "no calls");
  assert.equal(cleanUsage({ provider: "gemini", model: "gemini-a", calls: 1, tokensIn: -1, tokensOut: 1 }), null);
  assert.equal(cleanUsage({ provider: "gemini", model: "gemini-a", calls: 1, tokensIn: 1.5, tokensOut: 1 }), null);
  assert.equal(cleanUsage({ provider: "gemini", model: "gemini-a", calls: 1, tokensIn: 1, tokensOut: 1 })?.pages, 0, "pages optional");
});

test("prices: typed amounts, both empty removes, junk refused; the migration seeds Claude's", async () => {
  assert.equal(parseAmount("2", 1000), 2);
  assert.equal(parseAmount("$0.075", 1000), 0.075);
  assert.equal(parseAmount("1e3", 1000), null);
  assert.equal(parseAmount("-1", 1000), null);
  assert.equal(parseAmount("", 1000), null);
  assert.deepEqual(cleanPrices({ "claude-a": { in: 1, out: 2 }, "x-model": { in: 1, out: 1 }, "gemini-b": { in: -1, out: 1 } }), { "claude-a": { in: 1, out: 2 } });
  const db = testDb();
  assert.deepEqual((await readPrices(db))["claude-sonnet-5-5"], { in: 2, out: 10 }, "seeded");
  assert.equal(await savePrice(db, "gemini-3.6-flash", "0", "0", "platform-admin", NOW), "ok_price");
  assert.equal(await savePrice(db, "gemini-3.6-flash", "abc", "1", "platform-admin", NOW), "bad_price");
  assert.equal(await savePrice(db, "not a model", "1", "1", "platform-admin", NOW), "bad_price");
  assert.deepEqual((await readPrices(db))["gemini-3.6-flash"], { in: 0, out: 0 });
  assert.equal(await savePrice(db, "gemini-3.6-flash", " ", "", "platform-admin", NOW), "ok_price");
  assert.equal((await readPrices(db))["gemini-3.6-flash"], undefined, "removed");
});

test("the cap: empty is no cap, amounts only", async () => {
  const db = testDb();
  assert.equal(await readCap(db), 0);
  assert.equal(await saveCap(db, "20", "platform-admin", NOW), "ok_cap");
  assert.equal(await readCap(db), 20);
  assert.equal(await saveCap(db, "twenty", "platform-admin", NOW), "bad_cap");
  assert.equal(await saveCap(db, "", "platform-admin", NOW), "ok_cap");
  assert.equal(await readCap(db), 0);
});

test("spend: worked out from prices; a model without a price is named, never guessed", () => {
  assert.equal(costUsd(1_000_000, 100_000, { in: 2, out: 10 }), 3);
  assert.equal(costUsd(1, 1, undefined), null);
  const s = summarise([
    { provider: "claude", model: "claude-sonnet-5-5", task: "topics", calls: 2, pages: 122, tokensIn: 1_000_000, tokensOut: 100_000 },
    { provider: "gemini", model: "gemini-x", task: "topics", calls: 1, pages: 61, tokensIn: 500_000, tokensOut: 50_000 },
    { provider: "claude", model: "claude-sonnet-5-5", task: "check", calls: 1, pages: 0, tokensIn: 10, tokensOut: 5 },
  ], { "claude-sonnet-5-5": { in: 2, out: 10 } });
  assert.ok(Math.abs(s.total - 3.00007) < 1e-9);
  assert.deepEqual(s.unpriced, ["gemini-x"]);
  assert.equal(s.byModel.find((m) => m.model === "gemini-x")?.usd, null);
  assert.equal(s.byModel.find((m) => m.model === "claude-sonnet-5-5")?.calls, 3);
  assert.equal(s.byTask[0]!.task, "topics");
  assert.equal(usdWords(null), "price not set");
  assert.equal(usdWords(0.004), "under $0.01");
  assert.equal(usdWords(3), "$3.00");
});

test("months: UTC bounds, earlier and later links, no later link past this month", () => {
  const m = monthBounds(undefined, NOW);
  assert.equal(m.key, "2026-11");
  assert.equal(m.from, Date.UTC(2026, 10, 1));
  assert.equal(m.next, null);
  assert.equal(m.prev, "2026-10");
  const o = monthBounds("2026-10", NOW);
  assert.equal(o.next, "2026-11");
  assert.equal(monthBounds("2026-13", NOW).key, "2026-11", "a bad month is this month");
});

test("rough cost and the cap: history wins over the size guess; a cap needs prices", () => {
  const prices = { "claude-sonnet-5-5": { in: 2, out: 10 }, "gemini-x": { in: 0, out: 0 } };
  const models = { claude: "claude-sonnet-5-5", gemini: "gemini-x" };
  const rough = estimateTopics(models, BRAIN.estBytesPerPage * 10, [], prices);
  assert.equal(rough.basis, "rough");
  const expected = costUsd(10 * BRAIN.estTokensPerPage * BRAIN.attempts, BRAIN.estOutTokens * BRAIN.attempts, prices["claude-sonnet-5-5"])!;
  assert.ok(Math.abs(rough.usd! - expected) < 1e-9);
  const hist = estimateTopics(models, 1, [{ model: "claude-sonnet-5-5", runs: 2, tokensIn: 2_000_000, tokensOut: 200_000 }, { model: "gemini-x", runs: 1, tokensIn: 1, tokensOut: 1 }], prices);
  assert.equal(hist.basis, "history");
  assert.ok(Math.abs(hist.usd! - 3) < 1e-9, "average per run");
  const unknown = estimateTopics({ claude: "claude-sonnet-5-5", gemini: "gemini-y" }, 1, [], prices);
  assert.equal(unknown.usd, null);
  assert.deepEqual(unknown.missing, ["gemini-y"]);
  assert.equal(capCheck(0, 999, unknown), "ok", "no cap: always");
  assert.equal(capCheck(10, 0, unknown), "no_price");
  assert.equal(capCheck(10, 8, hist), "over_cap");
  assert.equal(capCheck(10, 7, hist), "ok");
});

test("recorded usage feeds the month, the latest runs, history and the Draft button's check", async () => {
  const db = testDb();
  db.raw.exec(`INSERT INTO job (id, type, status, params, created_at) VALUES ('job-1', 'brain', 'succeeded', '{"task":"topics","syllabusId":"0625-2023"}', ${NOW})`);
  await recordSpend(db, "job-1", "topics", { provider: "claude", model: "claude-sonnet-5-5", calls: 1, pages: 61, tokensIn: 1_000_000, tokensOut: 100_000 }, NOW);
  await recordSpend(db, "job-1", "topics", { provider: "gemini", model: "gemini-3.5-flash", calls: 1, pages: 61, tokensIn: 500_000, tokensOut: 10_000 }, NOW);
  await recordSpend(db, null, "check", { provider: "claude", model: "claude-sonnet-5-5", calls: 1, pages: 0, tokensIn: 10, tokensOut: 5 }, Date.UTC(2026, 9, 30));
  const prices = await readPrices(db);
  const m = monthBounds(undefined, NOW);
  const s = await spendBetween(db, m.from, m.to, prices);
  assert.ok(Math.abs(s.total - 3) < 1e-9, "only this month, priced models only");
  assert.deepEqual(s.unpriced, ["gemini-3.5-flash"]);
  const runs = await recentRuns(db, prices);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.syllabusId, "0625-2023");
  assert.equal(runs[0]!.usd, null, "an unpriced model makes the run's spend unknown");
  assert.deepEqual(await taskHistory(db, "topics", ["claude-sonnet-5-5"]), [{ model: "claude-sonnet-5-5", runs: 1, tokensIn: 1_000_000, tokensOut: 100_000 }]);
  const env = { CLAUDE_MODEL: "claude-sonnet-5-5", GEMINI_MODEL: "gemini-3.5-flash" };
  assert.equal((await topicsCostCheck(db, env, 1_000_000, NOW)).verdict, "ok", "no cap");
  await saveCap(db, "5", "platform-admin", NOW);
  assert.equal((await topicsCostCheck(db, env, 1_000_000, NOW)).verdict, "no_price", "Gemini has no price");
  await savePrice(db, "gemini-3.5-flash", "0", "0", "platform-admin", NOW);
  const c = await topicsCostCheck(db, env, 1_000_000, NOW);
  assert.equal(c.estimate.basis, "history");
  assert.equal(c.spent, 3);
  assert.equal(c.verdict, "over_cap", "3 spent and about 3 more would pass the 5 cap");
  await saveCap(db, "10", "platform-admin", NOW);
  assert.equal((await topicsCostCheck(db, env, 1_000_000, NOW)).verdict, "ok");
});

test("Read with: the Reading AI first, the key's other Claude models, Gemini alone; each priced on its own", async () => {
  const db = testDb();
  const env = { CLAUDE_MODEL: "claude-sonnet-5-5", GEMINI_MODEL: "gemini-3.5-flash" };
  await savePrice(db, "gemini-3.5-flash", "0", "0", "platform-admin", NOW);
  db.raw.exec(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('ai_models', '{"reading":"claude-haiku-5-5"}', 'x', ${NOW})`);
  db.raw.exec(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('ai_check', '${JSON.stringify({ claude: { model: "claude-sonnet-5-5", status: "works", detail: "" }, gemini: { model: "gemini-3.5-flash", status: "works", detail: "" }, models: [], claudeModels: [{ name: "claude-haiku-5-5", label: "Haiku", status: "works", detail: "" }, { name: "claude-opus-5-5", label: "Opus", status: "works", detail: "" }], at: NOW, claudeAt: NOW, geminiAt: NOW })}', 'brain', ${NOW})`);
  const c = await readerChoices(db, env, 1_000_000, NOW);
  assert.deepEqual(c.map((x) => x.value), ["", "claude-opus-5-5", "gemini"]);
  assert.match(c[0]!.label, /Claude Haiku 5\.5 \(your Reading AI\), checked by Gemini 3\.5 Flash/);
  assert.match(c[2]!.label, /Gemini 3\.5 Flash alone/);
  assert.equal(c[2]!.check.estimate.usd, 0, "Gemini alone costs only Gemini (free here)");
  assert.ok((c[1]!.check.estimate.usd ?? 0) > (c[0]!.check.estimate.usd ?? 0), "Opus costs more than Haiku");
  // Gemini alone leaves Claude out of the estimate entirely (no price needed for it).
  assert.deepEqual(estimatePaper({ reading: "gemini", gemini: "gemini-3.5-flash" }, 500_000, { paper: [] }, { "gemini-3.5-flash": { in: 0, out: 0 } }).missing, []);
});
