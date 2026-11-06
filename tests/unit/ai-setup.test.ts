// AI setup (Phase 2 step 2a): which Gemini models to try, reading Google's answers, the chosen model, check runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiModels, chooseModel, cleanCheck, geminiStatus, lastCheck, modelsToTry, retryDelayMs, saveCheck } from "../../src/lib/brain/aiSetup.ts";
import { activeBrainRun, claimBrainRun, finishCheckRun, lastCheckRun, saveTree, startCheckRun, startTreeRun } from "../../src/lib/brain/runs.ts";
import { BRAIN } from "../../src/lib/config.ts";
import { testDb } from "./helpers/d1.ts";

const NOW = Date.UTC(2026, 10, 6);

test("models to try: text models only, stable and newest first, capped, the one in use always included", () => {
  const listed = [
    "gemini-2.0-flash", "gemini-3.5-flash", "gemini-3.5-pro-preview-06-05", "gemini-embedding-001", "gemini-2.5-flash-preview-tts",
    "gemini-3.1-flash-lite", "gemini-2.5-pro", "gemini-live-2.5-flash", "gemini-2.0-flash-exp-image-generation", "text-bison",
  ];
  const t = modelsToTry(listed, "gemini-1.5-flash");
  assert.equal(t[0], "gemini-1.5-flash", "the one in use is tried even if Google does not list it");
  assert.deepEqual(t.slice(1, 4), ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-pro"]);
  assert.ok(!t.some((n) => /embed|tts|live|image|bison/.test(n)));
  assert.ok(t.indexOf("gemini-3.5-pro-preview-06-05") > t.indexOf("gemini-2.0-flash"), "previews after stable models");
  const many = Array.from({ length: 30 }, (_, i) => `gemini-${i}.0-flash`);
  assert.equal(modelsToTry(many, "gemini-29.0-flash").length, BRAIN.checkModels);
});

test("Google's answers in plain statuses: works, busy, not on the plan, unknown model, key refused", () => {
  assert.equal(geminiStatus(200, "{}"), "ok");
  assert.equal(geminiStatus(404, "not found"), "not_found");
  assert.equal(geminiStatus(429, `{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro"}}`), "not_on_plan");
  assert.equal(geminiStatus(429, `{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 10"}}`), "busy");
  assert.equal(geminiStatus(400, `{"error":{"message":"API key not valid. Please pass a valid API key."}}`), "refused");
  assert.equal(geminiStatus(403, ""), "refused");
  assert.equal(geminiStatus(500, ""), "error");
  assert.equal(retryDelayMs(`{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"31s"}`), 31_000);
  assert.equal(retryDelayMs(`"retryDelay": "500s"`), BRAIN.geminiMaxWaitMs, "capped");
  assert.equal(retryDelayMs("no hint"), 15_000);
});

test("check results are cleaned; only a model the last check found working can be chosen; the choice wins over the var", async () => {
  const c = cleanCheck({ claude: { model: "claude-x", status: "ok" }, gemini: { model: "gemini-a", status: "weird" }, models: [{ name: "gemini-a", status: "ok" }, { name: "bad name!", status: "ok" }, { name: "gemini-b", status: "busy", detail: "x\u0000y" }] }, NOW);
  assert.equal(c.gemini.status, "error");
  assert.deepEqual(c.models.map((m) => m.name), ["gemini-a", "gemini-b"]);
  assert.equal(c.models[1]!.detail, "x y");
  const db = testDb();
  const env = { CLAUDE_MODEL: "claude-sonnet-5-5", GEMINI_MODEL: "gemini-default" };
  assert.deepEqual(await aiModels(db, env), { claude: "claude-sonnet-5-5", gemini: "gemini-default", claudeChosen: false, geminiChosen: false });
  assert.equal(await chooseModel(db, "gemini", "gemini-a", "platform-admin", NOW), "bad_model", "no check yet");
  await saveCheck(db, { models: [{ name: "gemini-a", status: "ok" }, { name: "gemini-b", status: "busy" }] }, "gemini", NOW);
  assert.equal((await lastCheck(db))?.models.length, 2);
  assert.equal(await chooseModel(db, "gemini", "gemini-b", "platform-admin", NOW), "bad_model", "not working");
  assert.equal(await chooseModel(db, "gemini", "gemini-a; drop", "platform-admin", NOW), "bad_model");
  assert.equal(await chooseModel(db, "other", "gemini-a", "platform-admin", NOW), "bad_model");
  assert.equal(await chooseModel(db, "gemini", "gemini-a", "platform-admin", NOW), "ok_model");
  assert.deepEqual(await aiModels(db, env), { claude: "claude-sonnet-5-5", gemini: "gemini-a", claudeChosen: false, geminiChosen: true });

  // A Claude check keeps the last Gemini result; any model on Anthropic's list may be chosen (only the one in use is tried).
  await saveCheck(db, { claude: { model: "claude-sonnet-5-5", status: "no_credit", detail: "low" }, claudeModels: [{ name: "claude-sonnet-5-5", status: "no_credit" }, { name: "claude-opus-5-5" }, { name: "gpt-x" }] }, "claude", NOW + 10);
  const c2 = (await lastCheck(db))!;
  assert.equal(c2.models.length, 2, "Gemini list kept");
  assert.equal(c2.geminiAt, NOW, "Gemini check date kept");
  assert.equal(c2.claudeAt, NOW + 10);
  assert.deepEqual(c2.claudeModels.map((m) => m.name), ["claude-sonnet-5-5", "claude-opus-5-5"], "only Claude names");
  assert.equal(c2.claude.status, "no_credit");
  assert.equal(await chooseModel(db, "claude", "claude-haiku-5-5", "platform-admin", NOW), "bad_model", "not on the list");
  assert.equal(await chooseModel(db, "claude", "claude-opus-5-5", "platform-admin", NOW), "ok_model");
  assert.deepEqual(await aiModels(db, env), { claude: "claude-opus-5-5", gemini: "gemini-a", claudeChosen: true, geminiChosen: true }, "both choices kept");
});

test("audio and transcription models are not offered", () => {
  assert.deepEqual(modelsToTry(["gemini-3.5-transcribe", "gemini-3.5-flash"], ""), ["gemini-3.5-flash"]);
});

test("check runs: one brain run at a time, claimed as a check, finished only as a check", async () => {
  const db = testDb();
  const id = (await startCheckRun(db, "platform-admin", "gemini", NOW))!;
  assert.ok(id);
  assert.equal(await startTreeRun(db, "0625-2023", "platform-admin", NOW + 1), null, "a tree run waits for the check");
  assert.deepEqual(await claimBrainRun(db, id, null, NOW + 2), { task: "check", which: "gemini" });
  assert.deepEqual(await activeBrainRun(db, id), { task: "check", which: "gemini" });
  assert.equal(await saveTree(db, id, { topics: [] }, {}, NOW + 3), "no_run", "a check run cannot save a tree");
  assert.equal((await lastCheckRun(db, NOW + 3))?.status, "running");
  assert.equal(await finishCheckRun(db, id, NOW + 4), true);
  assert.equal((await lastCheckRun(db, NOW + 5))?.status, "succeeded");
  assert.equal(await finishCheckRun(db, id, NOW + 6), false);
});
