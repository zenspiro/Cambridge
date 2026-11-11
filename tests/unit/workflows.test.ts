import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";

const DIR = new URL("../../.github/workflows/", import.meta.url).pathname;

// GitHub refuses to start a run from a workflow file it cannot read, and the app only hears "refused" (owner,
// 11 Nov 2026: "Read the benchmark papers" failed after an unquoted ": " in brain.yml). Every workflow must parse.
test("every workflow file is valid YAML with jobs that have steps", () => {
  const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const doc = parse(readFileSync(DIR + f, "utf8"), { strict: true, uniqueKeys: true }) as { on?: unknown; jobs?: Record<string, { steps?: unknown[] }> };
    assert.ok(doc && typeof doc === "object", `${f} parses`);
    assert.ok(doc.on, `${f} has triggers`);
    for (const [name, job] of Object.entries(doc.jobs ?? {})) assert.ok(Array.isArray(job.steps) && job.steps.length > 0, `${f}: job ${name} has steps`);
  }
});
