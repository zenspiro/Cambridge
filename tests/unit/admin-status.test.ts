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
