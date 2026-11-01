# History

Newest first. What changed, why, and how it was tested.

## 2026-11-01: Step 0, repo and CI

**What**
- Next.js 16 app on Cloudflare Workers through OpenNext, with D1 (`cambridge`) and two private R2 buckets (`cambridge` for app files, `cambridge-source` for Cambridge documents).
- Security headers and a per-request CSP nonce on every response; static files covered by `public/_headers`.
- Error helper that shows visitors a reference id only.
- `/health` checks D1 and both buckets, pass or fail only.
- First migration: `job` table.
- CI: typecheck, unit tests, inline check, build, local migrations, browser smoke test; on `main` also production migrations, deploy and a health check.
- Docs: brief, CLAUDE.md, README, feature list, dev checklist, tests README.

**Why**
- Brief step 0. A second bucket keeps Cambridge source files apart, so they can never be served by mistake.
- Vitest was dropped for Node's own test runner: Vitest hit an npm peer dependency error, and the built-in runner needs no dependency.
- Edge `middleware.ts` instead of Next 16 `proxy.ts`: OpenNext marks Node middleware as experimental.

**Tested**
- 14 unit tests pass (headers, CSP, error refs, additive migrations, Worker config, inline check). One caught a real bug: the error logger could throw on a hostile value. Fixed.
- Typecheck and `check:inline` pass.
- OpenNext build passes; local migration applied.
- Local Worker: `/health` returns ok with all security headers; browser smoke test passes at 375 px and 1400 px (no sideways scroll, no script or CSP errors, every script has the nonce).
- Not tested yet: the production deploy (runs in CI after merge to `main`).
