# CLAUDE.md: Cambridge exam prep

Current state, kept short. The full brief (product, copyright rules, standards) is `docs/BRIEF.md`; read it first. Section 15 applies to every change.

## Owner preferences
- Replies: short, humanized bullet points, one topic or step at a time.
- Never use the em dash character anywhere: replies, code, comments, commits, docs, page copy.
- Plan first. Code only after the owner says "go", "start", "proceed" or similar. Give options with a recommendation.
- Never ask for secret values. Never open a pull request unless asked. Commits carry no AI model names.
- 375 px is the narrowest phone width to design and test for.

## Status
- Step 0 (repo, CI, Cloudflare, docs) live.
- Admin sign-in (Step 1-lite) live: one platform admin, password only (owner decision).
- Build 3a (source library) built. Next: 3b, the acquisition agent (GitHub Actions). Owner moved this ahead of the rest of Step 1.
- Subject: Physics 0625 (owner decision). Library years 2022 to 2026 (owner decision).
- This session's network blocks cambridgeinternational.org and workers.dev; the owner was told which hosts to allow.
- Open decisions: `docs/BRIEF.md` section 14.

## Stack in this repo
- Next.js 16 + React 19 + Tailwind 4, on Cloudflare Workers through OpenNext (`@opennextjs/cloudflare`). Versions pinned exactly in `package.json`.
- `wrangler.jsonc`: Worker `cambridge`, D1 `DB` (cambridge), R2 `FILES` (cambridge, app files) and `SOURCE` (cambridge-source, Cambridge documents, admin only, never served by URL). No routes: the app is on `cambridge.zenspiroapps.workers.dev`.
- The D1 id in `wrangler.jsonc` is a placeholder; CI fills it by name (`scripts/set-d1-id.ts`).
- Settings come from `vars` or the database, never hardcoded (`APP_NAME` is the brand name).
- Bindings in code: `getEnv()` in `src/lib/env.ts`. Types: `npm run cf:types` writes `cloudflare-env.d.ts` (not committed).

## Security baseline (already in place)
- `src/middleware.ts` sets a per-request CSP nonce and the headers from `src/lib/security/headers.ts` on every page and API route. Static files get theirs from `public/_headers`. Any outside host must be added to `buildCsp` on purpose.
- We use `middleware.ts` (edge) rather than Next 16's `proxy.ts`, because OpenNext marks Node middleware as experimental. The build prints a deprecation notice for it; that is expected.
- Every page is rendered per request (the layout reads headers), which the nonce needs.
- Errors: `reportError()` and `publicErrorBody()` in `src/lib/errors.ts`. Visitors see a reference only. Page errors show Next's digest as the reference.
- `npm run check:inline` blocks inline styles, HTML event handlers, raw HTML, eval, script tags and browser dialogs in `src/`. Counts live in `scripts/inline-baseline.json` and may never grow. React props like `onClick` are fine.
- Access: every `page.tsx` and `route.ts` either calls `requireAdmin()` / `adminSession()` (`src/lib/auth/guard.ts`) or is listed in `PUBLIC_ROUTES` (`src/lib/access.ts`). `tests/unit/access.test.ts` enforces it.
- Forms: plain POST to a route handler, then a 303 redirect (`redirectTo` in `src/lib/http.ts`, same-site paths only). Every POST checks `isSameOrigin`. Messages travel as fixed codes (`?e=bad`), never as text.

## Admin sign-in
- One platform admin (actor id `platform-admin`). Password from the Worker secret `ADMIN_PASS` (must be a Secret, not a Variable, or deploys wipe it). Under 12 characters disables sign-in.
- Logic in `src/lib/auth/session.ts` (takes the database as a parameter; unit tested on SQLite). SQL in `src/lib/auth/queries.ts`. Settings in `AUTH` (`src/lib/config.ts`).
- Attempts are counted per hashed IP before the password is checked, in one atomic write: 5 per 15 minutes. A right password clears the count.
- Session cookie `__Host-admin` (HttpOnly, Secure, SameSite=Strict), 12 hours, only its SHA-256 stored in `admin_session`.
- `audit_log` records sign-in, failed try, lockout (once) and sign-out. Never passwords, tokens or IPs. Kept when accounts go (no cascade).
- Local password: `.dev.vars` (copy `.dev.vars.example`).

## Source library (build 3a)
- Pages: `/admin/library` (filters by year, session, type, paper), `/admin/library/gaps`, `/admin/library/upload`, `/admin/sources`. Frame and nav: `src/components/AdminShell.tsx`.
- Files live in R2 `SOURCE` at `code/year/session/file_name`; rows in `source_document`. Only `src/app/admin/` may touch `env.SOURCE` (unit test). Downloads are attachments, `no-store`, audited (`source.download`).
- One store path for uploads and the agent: `storeDocument()` in `src/lib/library/store.ts`. It checks the Cambridge name (`names.ts`), year range, size, PDF header and syllabus version, then reserves the row as `pending` (unique name and SHA-256, so races and duplicates are caught), writes R2, marks `stored`, audits.
- File types: qp, ms, in, ci, er, gt per exam session; sp, sm, in, ci, sy for specimens (session `y`). Brief listed qp, ms, er, gt, sp; the rest are real Cambridge types.
- Syllabus versions are rows (`0625-2020`, `0625-2023`, `0625-2026`); a file joins the version for its year. Version years still to be confirmed on Cambridge's site. Gap rules are JSON in `syllabus.expected`, read by `expected.ts`.
- Settings: `LIBRARY` in `src/lib/config.ts` (years, `lastSession` that counts for gaps, upload limits). Update `lastSession` when a new session's papers go public.
- Approved sources: `source_site`, seeded with Cambridge's official site. Addresses must be public https (`normaliseSiteUrl`). Remove uses the inline Yes / Never mind confirm.
- Rate limits: one helper, `src/lib/ratelimit.ts` (`allow`, keys hashed), on the `login_attempt` table for every kind of limit.
- Jobs: `src/lib/jobs.ts`. Each upload batch is a `source_upload` job with per-file results.

## Database
- Migrations in `migrations/NNNN_name.sql`, additive only (a unit test blocks DROP, RENAME, DELETE).
- Conventions: TEXT random ids, INTEGER milliseconds for times, JSON as TEXT with `json_valid`, real foreign keys with `ON DELETE CASCADE` toward the owning user, so deletion and export find every row.
- Tables: `job`, `admin_session`, `login_attempt` (all rate limits), `audit_log`, `subject`, `syllabus`, `source_site`, `source_document`.
- Shared types `Db` and `Bucket`: `src/lib/db.ts`. Logic takes them as parameters so unit tests run it on SQLite and an in-memory bucket.

## Commands
See README.md. Before every push: `npm run check`, `npm run build:worker`, `npm run db:migrate:local`, then with `npx wrangler dev` running, `npm run test:e2e`. Full list: `DEV-CHECKLIST.md`.

## Docs to keep current (same commit as the code)
`CLAUDE.md` (this), `HISTORY.md`, `FEATURES.md`, `DEV-CHECKLIST.md`, `tests/README.md`, `docs/guides/`.
