import { test } from "node:test";
import assert from "node:assert/strict";
import { newErrorRef, publicErrorBody, reportError } from "../../src/lib/errors.ts";

test("error refs are short, readable and unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const r = newErrorRef();
    assert.match(r, /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/);
    seen.add(r);
  }
  assert.equal(seen.size, 1000);
});

test("reportError logs the ref and details, and never throws", (t) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (s: string) => lines.push(s));
  const ref = reportError("unit.test", new Error("db exploded"));
  const entry = JSON.parse(lines[0]!);
  assert.equal(entry.ref, ref);
  assert.equal(entry.message, "db exploded");
  assert.doesNotThrow(() => reportError("unit.test", { toString() { throw new Error("x"); } }));
});

test("the public body carries only a reference, no details", () => {
  const body = publicErrorBody("ABCD-EFGH");
  assert.deepEqual(Object.keys(body).sort(), ["error", "ok", "ref"]);
  assert.ok(!/stack|exploded/i.test(JSON.stringify(body)));
});
