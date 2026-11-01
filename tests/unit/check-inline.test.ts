import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../../scripts/check-inline.ts";

test("banned patterns are counted", () => {
  const bad = [
    `<div style={{ color: "red" }} />`,
    `<button onclick="go()">`,
    `<div dangerouslySetInnerHTML={{ __html: x }} />`,
    `el.innerHTML = x`,
    `eval("1")`,
    `<script>alert(1)</script>`,
    `if (confirm("Delete?")) {}`,
  ].join("\n");
  const c = scan(bad);
  assert.equal(c["style-attr"], 1);
  assert.equal(c["html-handler"], 1);
  assert.equal(c["raw-html"], 2);
  assert.equal(c["eval"], 1);
  assert.equal(c["inline-script"], 1);
  assert.equal(c["browser-dialog"], 2);
});

test("normal React code passes", () => {
  const ok = `<button className="btn" onClick={save}>Save</button>\nconst onConfirm = () => api.confirm(id);\nel.textContent = name;`;
  assert.ok(Object.values(scan(ok)).every((n) => n === 0));
});
