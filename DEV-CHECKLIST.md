# Dev checklist

Update this file whenever the process changes.

## Before writing code
- [ ] Read `CLAUDE.md` and the relevant parts of `docs/BRIEF.md`.
- [ ] Diagnose, propose options with a recommendation, wait for the owner's go.

## While building (brief 15.2 to 15.5)
- [ ] Every new route: `requireAdmin()` / `adminSession()` (or listed in `PUBLIC_ROUTES` on purpose), ownership check on every record.
- [ ] Every POST: `isSameOrigin`, rate limit (`allow` in `src/lib/ratelimit.ts`), then a 303 redirect via `redirectTo`.
- [ ] Cambridge files: only through `storeDocument()`; only `src/app/admin/`, `api/agent/file`, `api/agent/doc` and `api/brain/doc` may touch `env.SOURCE`; downloads audited.
- [ ] Agent and brain endpoints (`/api/agent/*`, `/api/brain/*`): `agentRequest()` first. New outside fetches by the agent: robots.txt, delay, same site only.
- [ ] Changing the agent's name rules: add the real example to `REAL` in `tests/unit/agent.test.ts`.
- [ ] Input validated on the server; output escaped; SQL bound parameters only.
- [ ] Settings and limits from config or the database, not hardcoded.
- [ ] Reuse an existing helper or class before writing a new one.
- [ ] Migrations additive only; real foreign keys so deletion and export pick up new tables.
- [ ] Any outside script or host added to `buildCsp` on purpose.
- [ ] AI calls: model names in Worker vars, keys only in secrets, never logged; every AI answer cleaned and checked by code before it is stored.
- [ ] No em dash characters anywhere.

## Before every push
- [ ] `npm run check` (typecheck, unit tests, inline check), and read its exit code: a filtered log can hide a failed inline check (merges #32 and #33 failed CI that way)
- [ ] `npm run build:worker`
- [ ] `npm run db:migrate:local`
- [ ] `.dev.vars` exists (copy `.dev.vars.example`)
- [ ] `npx wrangler dev --local --port 8787`, then `npm run test:e2e` (public pages at 375 px and 1400 px; admin pages at 1400 px only, desktop only by owner decision; student and parent frames at 375 px in all three themes)
- [ ] New test suites listed in `tests/README.md`
- [ ] `CLAUDE.md`, `HISTORY.md`, `FEATURES.md`, `docs/guides/` updated in the same commit
- [ ] Commit message carries no AI model names
