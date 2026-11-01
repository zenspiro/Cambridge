# Tests

## Unit tests (`tests/unit/`, `npm run test:unit`)
Node's built-in test runner, TypeScript loaded directly. Files must not import Next or Cloudflare modules. `helpers/d1.ts` gives a D1 stand-in on Node's SQLite with every migration applied, so database logic is tested with the real SQL.

| Suite | Checks |
|---|---|
| `headers.test.ts` | Nonce format, strict production CSP, dev relaxations, bad nonces refused, baseline headers |
| `errors.test.ts` | Error refs are readable and unique; logger never throws; public body has only a reference |
| `migrations.test.ts` | Migrations numbered without gaps; no DROP, RENAME or DELETE |
| `config.test.ts` | Worker, D1 and both R2 buckets bound; no routes; no secrets in vars |
| `auth.test.ts` | Admin sign-in on a real SQLite copy of the schema: lockout, parallel burst, expiry, sign-out, audit content, token stored hashed |
| `http.test.ts` | Same-origin POST check; redirects stay on our site |
| `access.test.ts` | Every page and route is in `PUBLIC_ROUTES` or checks the admin session |
| `library.test.ts` | Cambridge file names, gap rules, PDF check, store (version pick, rejections, duplicates, parallel uploads, storage failure), source site rules and audit, seed data, jobs, and only admin code touching the source bucket |
| `ratelimit.test.ts` | Per-key windows, reset, hashed keys |
| `check-inline.test.ts` | The inline code scanner catches each banned pattern and passes normal React code |

## Browser smoke test (`tests/e2e/smoke.mjs`, `npm run test:e2e`)
Needs a running Worker (`npx wrangler dev --port 8787`, or set `BASE_URL`). Each page at 375 px and 1400 px: right status, has an h1, no sideways scroll, no script or console errors (CSP violations show here), every script carries the nonce. Add new pages to `PAGES`.

## Admin sign-in test (`tests/e2e/admin.mjs`, part of `npm run test:e2e`)
Needs a running Worker and `.dev.vars` (copy `.dev.vars.example`). The full sign-in and sign-out flow at 375 px and 1400 px, cookie flags, replayed cookie, cross-site and Origin-less POSTs, forged cookie, and the lockout. Each run uses made-up networks (`cf-connecting-ip`), so lockouts do not carry over between runs.

## Library test (`tests/e2e/library.mjs`, part of `npm run test:e2e`)
Needs a running Worker with migrations applied and `.dev.vars`. Upload (good, bad name, fake PDF), library listing, download, junk filters, gap report, sources (add, refused address, switch off, inline confirm, remove) at 375 px and 1400 px, and signed-out and cross-site attempts on every library page and POST. Uses a random valid file name each run; re-running is safe. Click buttons by their form, not by `button[type=submit]`: the header's Sign out button comes first.
