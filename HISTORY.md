# History

Newest first. What changed, why, and how it was tested.

## 2026-11-01: Source library (build 3a)

**What**
- Admin pages: library (filters, grouped by session), gap report, multi-file upload with per-file results, approved sources (add, switch on or off, remove with inline confirm).
- Migration 0003: `subject`, `syllabus` (three 0625 versions), `source_site` (Cambridge official seeded), `source_document`; `job` gains `created_by` and `result`.
- One store path for uploads and the coming agent; one rate limiter for every write (sign-in moved onto it); jobs helper.
- Admin-only, audited downloads as attachments.

**Why**
- Owner moved the acquisition agent forward; the library is where its files land and where the AI steps will read them. Split into 3a (library) and 3b (agent), owner agreed.
- Physics 0625, 2022 to 2026 (owner decisions). Files are tagged with the syllabus version for their year, so later steps can prefer the current one.
- Files are reserved in the database before writing to storage, so two uploads of the same file cannot overwrite each other.

**Tested**
- 42 unit tests pass (15 new: 14 for the library, name parser, gap rules, PDF check, store with version pick, rejections, duplicates, parallel uploads, storage failure clean-up, source address rules, source changes audited, seed, jobs, a check that only admin code touches the source bucket, and 1 for the rate limiter).
- Typecheck, inline check, build, local migration 0003.
- Browser at 375 px and 1400 px (40 checks): upload with good, badly named and fake files; library listing; download as an attachment; junk filters ignored; gap report; sources add, refused IP address, switch off, inline confirm, Never mind, remove; no sideways scroll; no script or CSP errors. Signed out, every library page and download redirects to sign-in; cross-site and signed-out POSTs are refused. Run twice to cover re-uploads.
- Fixed during testing: two test-script bugs (clicked Sign out instead of Upload; did not wait for page changes), a seed time one day in the future, Sign out wrapping on phones.
- Not tested: real Cambridge files (no network access to Cambridge from this session).

## 2026-11-01: Admin sign-in (Step 1-lite)

**What**
- `/admin/login` (password form), `/admin` (admin home with recent activity), sign-out.
- Migration 0002: `admin_session`, `login_attempt`, `audit_log`.
- Route access list (`PUBLIC_ROUTES`) with a test that every page and route is either listed or checks the admin session.
- Same-origin check on every POST; same-site-only redirect helper.

**Why**
- Owner moved the source library and acquisition agent forward. Source files are admin only and every access must be audited (brief 3.2), so a sign-in is needed first. Owner chose one platform admin with a password for now; Better Auth with email codes and Google comes later.
- Attempts are counted before the password check, so a burst of parallel requests cannot get more than 5 guesses.

**Tested**
- 27 unit tests pass (13 new: password compare, sign-in, lockout and window reset, parallel burst, counter clear, expiry, junk tokens, sign-out, audit content, same-origin, redirects, route access).
- Typecheck, inline check, OpenNext build, local migration 0002.
- Browser, at 375 px and 1400 px: signed-out redirect, wrong password message, sign-in, cookie flags, activity list, no sideways scroll, sign-out, replayed old cookie refused, no script or CSP errors. Attacker checks: cross-site and Origin-less POST refused, forged cookie refused, 6th try locked even with the right password, other networks unaffected.

## 2026-11-01: Fix first production deploy

**What:** `npm run build` now generates the binding types (`cf:types`) before `next build`.

**Why:** the first deploy on `main` failed. The deploy job builds without running typecheck first, so `cloudflare-env.d.ts` (not committed) was missing and Next's type check could not see `DB`, `FILES`, `SOURCE` and `APP_NAME`. The token, D1 lookup and production migration all worked.

**Tested:** deleted `cloudflare-env.d.ts`, ran `npm run build:worker` from clean: types generated, build passes.

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
