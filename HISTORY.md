# History

Newest first. What changed, why, and how it was tested.

## 2026-11-02: Admin is desktop only

**What:** admin browser suites (sign-in, library, agent) now run at desktop width only; the smoke test keeps public pages at 375 px and 1400 px and checks the sign-in page at 1400 px.

**Why:** owner decision: the admin panel stays on the web (desktop); phones are for students.

**Tested:** full e2e suite passes at the new widths (140 checks; the drop from 181 is the phone runs of admin pages); phone checks remain only for public pages.

## 2026-11-02: Agent activity in plain words

**What**
- Activity lines describe what happened instead of file names: "Stored: June 2024, Paper 1 Multiple Choice (Core), variant 1, question paper (1.2 MB)", "Not stored: ... Not a PDF", "Read \"Cambridge IGCSE Physics (0625)\": 27 PDF links. 14 new: June 2024: 6 question papers, 6 mark schemes, ...", a start line saying what the run will do, a robots.txt line that explains it, and a closing summary.
- Run page: "Library after this run" (or "What a download would add" for a dry run) with each session touched, what was added, how many are essential vs extras, its status and a link; file lists grouped by session and described in words; short explanations on "Links not recognised" and "Blocked by robots.txt".
- Events are structured (file, outcome, reason, size), checked on the way in; up to 120 kept per run (was 30).

**Why**
- Owner: the activity showed only file names, which told the admin nothing.

**Tested**
- 71 unit tests pass (4 new: session summaries, page titles, event checking, reasons and version lookup).
- 181 browser checks, run twice. New in the agent suite: page named by its title, robots.txt explained, files described with paper names, failures with reasons in words, closing summary, "Library after this run" links and statuses, lists grouped by session, dry run described and "What a download would add".
- The agent test's local database helper now retries: Wrangler's local tool failed once with "internal error" while the dev server was using the same file.

## 2026-11-01: Papers, routes, variant 2, and the subject overview

**What**
- Subject page is now an overview: status with the most-missing sessions, search and filters that give a short described list, a year by session grid of coloured tiles (one row per year), syllabus version tiles, the papers table and the Core and Extended routes, and the subject's essential variants.
- New pages: one per exam session (whole-session files, the essential variant table with paper names and Core / Extended tags, other variants folded, older and newer links) and one per syllabus version (syllabus documents and specimens).
- Papers and routes per syllabus version (migration 0007): 0625 papers 1 to 6 with format, tier, time, marks and weighting; Core and Extended routes with grade ranges. Checked against Cambridge's syllabus PDFs for 2023 to 2025 and 2026 to 2028.
- Variant 2 is essential (per syllabus, with a library-wide default).
- Files are described in plain words on results, the add page and the catalog API.

**Why**
- Owner: the subject page was too long to read and will grow every year; paper codes (1 MCQ Core, 2 MCQ Extended and so on) matter for the admin and the AI engine; Pakistan sits variant 2.

**Tested**
- 67 unit tests pass (3 new: papers and routes seed, plain-word descriptions, per-syllabus variants; plus a guard against long UNION chains).
- 171 browser checks, run twice: overview grid and rows per year, papers and routes, short overview, session page (breadcrumb, variant 2, paper names, tier tags, pager, unknown session is 404), version page, described search results, download, filters, per-syllabus variants (none refused, saved), add page wording, signed-out and cross-site attempts on the new pages and POST.
- Fixed during testing: the 0007 seed used a six-part UNION ALL, which D1 refuses (unit tests on Node's SQLite passed; the local D1 migration caught it, and CI would have too); long paper names spilled into the next column on phones; uneven grid columns.
- Note: the 14 June 2024 files downloaded earlier are variant 1, so they now count as extras.

## 2026-11-01: Library hierarchy, checklist, search and add-a-file

**What**
- Library home: qualifications (IGCSE, O Level, AS & A Level), each with subject cards showing an essentials bar (green, amber, red) and extras count; search across the whole library.
- Subject page: breadcrumb (Library > qualification > subject), overall status, filters (year, session, type, paper, status) and search, then foldable groups with their own status: syllabus documents and specimens per syllabus version, and every exam session as a table of papers and variants (QP, MS, CI) plus examiner report and grade thresholds. Green tick downloads; a red cross or grey + opens Add.
- Add a missing file: upload any file name (saved under the checklist name) or paste a link from an approved source.
- Settings: essential variants per session (default variant 1, March 2); other variants show as extras.
- New document types: syllabus update and grade descriptions, recognised from Cambridge's links.
- Signed `/api/agent/catalog`: the same tree for the AI engine (metadata only).
- Gaps page removed (its job is now in the library).
- Migration 0006: `qualification`, `subject.qualification_id`, `source_document` rebuilt (types su, gd; origin link), checklist rules, essential variants.

**Why**
- Owner: one neatly organised Library screen by subject with filters and search, status per subject and per document, and a way to add variants from other sources or by hand; hierarchy by qualification for the admin and the AI engine.
- Rebuilding `source_document` breaks "additive only"; the owner approved it once (only test data so far). The test allows that one file by name and checks every column and row is copied.

**Tested**
- 64 unit tests pass (7 new: checklist groups and counts, stored and extra files, essential variants setting, filters and search incl. "paper 4", hierarchy load, rebuilt table, and the rebuild's column copy).
- 134 browser checks, run twice: qualifications and subject cards, search, breadcrumb, cell download, junk filters ignored, Missing filter, subject search, unknown syllabus, add flow (unapproved link refused, upload with any name ticks the cell), signed-out and cross-site attempts on the new pages and POSTs.
- Local migration 0006 on a database with 17 stored files: all 17 kept.
- Fixed during testing: "4" matched every 2024 (numbers now match whole words); specimen table overflowed its card on phones; empty version showed a red 0/0.

## 2026-11-01: Live agent feedback and Cancel

**What**
- Run page while the agent works: progress bar with percentage, current step, time so far and since the last update, an activity log (one line per page and per file, newest first, times to the second), a link to the run's GitHub log, and Cancel run with an inline Yes / Never mind. The page reloads itself every 10 seconds while the run is active and stops when it ends.
- Agent sends a signed update at each step (`/api/agent/progress`) and stops if the run was cancelled.
- Stuck runs: a warning after 5 minutes if GitHub has not started the run; runs with no sign of life for 15 minutes close themselves (was 3 hours), with a message naming the likely cause.
- Migration 0005: `job.heartbeat_at`, `step`, `events`, `run_url`.

**Why**
- Owner asked for reasonable feedback while the agent runs.
- The first production dry run never started: `AGENT_SECRET` was under GitHub's Agents secrets, not Actions. The run sat "Waiting to start" with no explanation and blocked new runs for 3 hours.
- Auto-reload uses a meta refresh rather than script, keeping to the brief's no-AJAX rule.

**Tested**
- 57 unit tests pass (4 new: progress updates and event cap, cancel, 15 minute rule for never-started and quiet runs, cleaning of agent text and GitHub links).
- 111 browser checks, run twice. New: live updates arrive, progress bar, auto-refresh on then off, activity log, time so far, no sideways scroll at 375 px, cancel mid-run (asks first, run shows Cancelled, agent stops itself), never-started run explains the cause.
- Fixed during testing: a file that failed to download had no activity line; reasons now read in plain words.

## 2026-11-01: Acquisition agent and settings (build 3b)

**What**
- `/admin/agent`: choose years, sessions (including Specimen) and dry run or download; Run starts GitHub Actions. Run list and run report (found, stored, not stored with reasons, links not recognised, robots.txt blocks, page errors). A dry run offers "Download these N files".
- `scripts/agent/run.ts` and `.github/workflows/agent.yml`: the agent. robots.txt first, start pages only, same-site PDF links only, 5 second gaps, honest name, no logins, no off-site redirects, at most 400 files per run, skips what is stored.
- Signed agent endpoints `/api/agent/job`, `/file`, `/finish` (HMAC, clock window, single-use nonce). Files go through the same store path as uploads.
- `/admin/settings`: library years and latest public session moved from code to the database.
- Start pages per source on `/admin/sources`, seeded with Cambridge's 0625 past-papers and overview pages.
- Migration 0004: `setting`, `source_page`, `request_nonce`.

**Why**
- Owner chose the Run button, selectable years and sessions, and a settings page, so new sessions can be added later without code.
- Agent in TypeScript (not Python) so it shares the Cambridge name rules with the library.
- The GitHub token needs only Actions access, not Contents, so a leaked token cannot change code.
- Built against Cambridge's real pages (fetched once, politely): robots.txt allows the PDFs; their names were used to write and test the translation.

**Found**
- Cambridge's public 0625 pages carry only June 2024 (variant 1 of each paper), the 2023 specimens and syllabus PDFs: 33 links, 30 usable. The rest of 2022 to 2026 is not public there.
- Syllabus versions confirmed on Cambridge's site: 2023 to 2025 and 2026 to 2028 (and a 2029 syllabus).

**Tested**
- 53 unit tests pass (11 new: signatures, replay guard, robots.txt incl. Cambridge's real file, real Cambridge names, link filtering, settings, run choices, one-run-at-a-time and stale runs, start pages; plus the http-only CSP rule).
- Typecheck, inline check, build, local migration 0004.
- 97 browser checks, run twice: all earlier suites plus a new agent suite against a fake source site (Run button without a token, dry run, robots.txt block, unknown links, download run storing 4 real PDFs and refusing a fake one, a 404 reported, re-run skips stored files, settings, unsigned / replayed / wrong-secret / old / off-site agent requests refused).
- Real dry run against Cambridge from the local Worker: 2 pages, 33 PDF links, 25 to fetch, 3 not recognised (syllabus update notes, grade descriptions), nothing downloaded.
- Fixed during testing: question papers are named "question-paper-11" (no "-paper"); the CSP's upgrade rule broke page prefetches on the local http server; test scripts tripped on Next's hidden alert element.
- Not tested: the real GitHub dispatch and a production run (need the owner's secrets).

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
