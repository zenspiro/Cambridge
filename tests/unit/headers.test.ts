import { test } from "node:test";
import assert from "node:assert/strict";
import { SECURITY_HEADERS, buildCsp, makeNonce } from "../../src/lib/security/headers.ts";

test("nonce is random 128-bit base64", () => {
  const a = makeNonce();
  const b = makeNonce();
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(a, b);
});

test("production CSP is strict", () => {
  const n = makeNonce();
  const csp = buildCsp(n);
  assert.ok(csp.includes(`'nonce-${n}'`));
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(!csp.includes("unsafe-inline"));
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(!/https?:/.test(csp), "no outside hosts unless added on purpose");
});

test("upgrade-insecure-requests is on for https and off only on plain http", () => {
  assert.ok(buildCsp(makeNonce()).includes("upgrade-insecure-requests"));
  const local = buildCsp(makeNonce(), { plainHttp: true });
  assert.ok(!local.includes("upgrade-insecure-requests"));
  assert.ok(!local.includes("unsafe-"), "nothing else is relaxed");
});

test("dev CSP relaxes only what hot reload needs", () => {
  const csp = buildCsp(makeNonce(), { dev: true });
  assert.ok(csp.includes("'unsafe-eval'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
});

test("a bad nonce is refused, so nothing can be injected into the header", () => {
  assert.throws(() => buildCsp("abc'; script-src *"));
  assert.throws(() => buildCsp(""));
});

test("baseline security headers are present", () => {
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
  assert.match(SECURITY_HEADERS["Strict-Transport-Security"] ?? "", /max-age=\d{8}/);
  assert.ok(SECURITY_HEADERS["Referrer-Policy"]);
  assert.ok(SECURITY_HEADERS["Permissions-Policy"]?.includes("camera=()"));
});
