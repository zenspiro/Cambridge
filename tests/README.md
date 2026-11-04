# Tests

Admin pages are desktop only (owner decision, 2 Nov 2026): the admin suites run at 1400 px. Public and student pages are tested at 375 px and 1400 px.

## Unit tests (`tests/unit/`, `npm run test:unit`)
Node's built-in test runner, TypeScript loaded directly. Files must not import Next or Cloudflare modules. `helpers/d1.ts` gives a D1 stand-in on Node's SQLite with every migration applied, so database logic is tested with the real SQL.

| Suite | Checks |
|---|---|
| `headers.test.ts` | Nonce format, strict production CSP, dev relaxations, bad nonces refused, baseline headers |
| `errors.test.ts` | Error refs are readable and unique; logger never throws; public body has only a reference |
| `migrations.test.ts` | Migrations numbered without gaps; no DROP, RENAME or DELETE except the named, explained exception (0006), whose copy keeps every column; no long UNION chains (D1 refuses them) |
| `config.test.ts` | Worker, D1 and both R2 buckets bound; no routes; no secrets in vars |
| `auth.test.ts` | Admin sign-in on a real SQLite copy of the schema: lockout, parallel burst, expiry, sign-out, audit content, token stored hashed |
| `http.test.ts` | Same-origin POST check; redirects stay on our site |
| `access.test.ts` | Every page and route is in `PUBLIC_ROUTES` or checks the admin session |
| `library.test.ts` | Cambridge file names, gap rules, PDF check, store (version pick, rejections, duplicates, parallel uploads, storage failure), source site rules and audit, seed data, jobs, and only admin code touching the source bucket |
| `ratelimit.test.ts` | Per-key windows, reset, hashed keys |
| `agent.test.ts` | Progress updates and event cap, cancel, 15 minute rule, cleaning agent text and links, signed requests and replay guard, robots.txt (incl. Cambridge's real file), Cambridge website names to standard names (real examples), PDF link filtering, settings, run choices, one run at a time, stale runs, start pages |
| `checklist.test.ts` | Checklist groups and counts, stored and extra files, essential variants (syllabus own, library default, damaged value), filters and search, hierarchy load, the rebuilt document table, papers and routes seed, plain-word file descriptions |
| `summary.test.ts` | File summaries by session, page titles, agent event checking, reasons in words, version lookup |
| `classify.test.ts` | Working out Cambridge names from Drive file and folder names (direct names, descriptive names, specimens, syllabus documents, unclear files with reasons), folder readings, which folders a run opens, bare numbers never read as codes, Drive link parsing |
| `map.test.ts` | Subject map: versions with documents, specimens and sessions, papers as columns with their file types, variants, inserts, school-assessed parts, the JSON for the AI |
| `ai.test.ts` | Workers AI answers: folder choices default to open, file names built from parts and kept only if the checklist asks for them, file names sent as data, summary cleaning, lenient JSON, running run only, per-run cap, unavailable and failing AI |
| `run-summary.test.ts` | Run summary facts by rules, real limits only, the AI rewording kept only when every number matches and no limit is invented |
| `check-inline.test.ts` | The inline code scanner catches each banned pattern and passes normal React code |

## Browser smoke test (`tests/e2e/smoke.mjs`, `npm run test:e2e`)
Needs a running Worker (`npx wrangler dev --local --port 8787`, or set `BASE_URL`). Public pages at 375 px and 1400 px, admin pages (sign-in) at 1400 px only: right status, has an h1, no sideways scroll, no script or console errors (CSP violations show here), every script carries the nonce. Add new pages to `PAGES`.

## Admin sign-in test (`tests/e2e/admin.mjs`, part of `npm run test:e2e`)
Needs a running Worker and `.dev.vars` (copy `.dev.vars.example`). The full sign-in and sign-out flow at desktop width (admin is desktop only), cookie flags, replayed cookie, cross-site and Origin-less POSTs, forged cookie, and the lockout. Each run uses made-up networks (`cf-connecting-ip`), so lockouts do not carry over between runs.

## Library test (`tests/e2e/library.mjs`, part of `npm run test:e2e`)
Needs a running Worker with migrations applied and `.dev.vars`. Upload (good, bad name, fake PDF), library home (qualifications, subject cards, search), subject overview (breadcrumb, grid, papers, routes, kept short), session and version pages, described search results and download, junk filters, Missing filter, per-syllabus essential variants, adding a missing file (unapproved link refused, upload with any name), sources (add, refused address, switch off, inline confirm, remove) at desktop width (admin is desktop only), and signed-out and cross-site attempts on every library page and POST. Uses a random valid file name each run; re-running is safe. Click buttons by their form, not by `button[type=submit]`: the header's Sign out button comes first. Find messages with `p.alert` / `p.notice`, not `[role=alert]`: Next adds a hidden route announcer with that role.

## Agent test (`tests/e2e/agent.mjs`, part of `npm run test:e2e`)
Needs a running Worker, migrations and `.dev.vars` (with `AGENT_SECRET`). Starts a fake source website (`fake-source.mjs`, port 9911), switches Cambridge's source off for the test, sets up runs in the local D1, runs `scripts/agent/run.ts` in test mode (http allowed only for localhost, 50 ms gaps), and checks the reports (described in words, grouped by session, "Library after this run"), the library, live feedback (progress bar, auto-refresh, activity log in plain words), cancelling a run mid-way, the never-started warning, a fake Google Drive API (folder paste, reading folders and naming files, private folder, key only in a header, download, Sources summary), "Needs your eye" (reject, undo, accept as a checklist file, the download fetches it under that name, a rejected file is skipped next run), the front page reader (an unnamed Drive file named from its cover, a misnamed one stored under its cover name, the library check finds and renames a mismatch), the settings page and attacks on the signed endpoints. Run the agent with async `spawn`, never `spawnSync`: the fake site lives in the test process. It never contacts Cambridge. Its local database helper retries up to 3 times (Wrangler's local tool can fail once while the dev server holds the file).
