// Which version is live (review, 10 Nov 2026): the commit and time CI writes at deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInfo } from "../../src/lib/buildInfo.ts";

test("the live build: a real commit with its deploy time; anything else is a local build", () => {
  const sha = "e26203d1362974fd92e446e82a56f06f0a8a4060";
  assert.deepEqual(buildInfo({ BUILD_COMMIT: sha, BUILD_AT: "2026-11-10T13:22:10.000Z" }), { commit: sha, short: "e26203d", at: Date.UTC(2026, 10, 10, 13, 22, 10) });
  assert.equal(buildInfo({ BUILD_COMMIT: sha, BUILD_AT: "" })?.at, null);
  assert.equal(buildInfo({ BUILD_COMMIT: "", BUILD_AT: "" }), null);
  assert.equal(buildInfo({ BUILD_COMMIT: "<script>" }), null);
  assert.equal(buildInfo({}), null);
});
