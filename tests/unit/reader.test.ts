// The door for readings made in a dev session (owner, 12 Nov 2026): a bearer key the session's proxy adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { READER_MIN_TOKEN, tokenMatches } from "../../src/lib/brain/reader.ts";

test("the reader key: only the whole key as a bearer token, and never a short secret", async () => {
  const key = "k".repeat(READER_MIN_TOKEN);
  assert.equal(await tokenMatches(key, `Bearer ${key}`), true);
  assert.equal(await tokenMatches(key, `Bearer ${key}x`), false);
  assert.equal(await tokenMatches(key, key), false, "not without Bearer");
  assert.equal(await tokenMatches(key, null), false);
  assert.equal(await tokenMatches("short", "Bearer short"), false, "a secret under 32 characters shuts the door");
  assert.equal(await tokenMatches(undefined, `Bearer ${key}`), false);
});
