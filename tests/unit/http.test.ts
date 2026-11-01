import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin, redirectTo } from "../../src/lib/http.ts";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://cambridge.example.dev/admin/session", { method: "POST", headers });

test("only same-origin POSTs pass", () => {
  assert.equal(isSameOrigin(req({ origin: "https://cambridge.example.dev" })), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example" })), false);
  assert.equal(isSameOrigin(req({ origin: "null" })), false);
  assert.equal(isSameOrigin(req()), false);
});

test("redirects stay on our site", () => {
  const loc = (p: string) => redirectTo(req(), p).headers.get("location");
  assert.equal(loc("/admin"), "https://cambridge.example.dev/admin");
  assert.equal(loc("//evil.example/x"), "https://cambridge.example.dev/");
  assert.equal(loc("/\\evil.example"), "https://cambridge.example.dev/");
  assert.equal(loc("https://evil.example"), "https://cambridge.example.dev/");
  assert.equal(redirectTo(req(), "/admin").status, 303);
});
