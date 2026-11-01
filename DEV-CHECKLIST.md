# Dev checklist

Update this file whenever the process changes.

## Before writing code
- [ ] Read `CLAUDE.md` and the relevant parts of `docs/BRIEF.md`.
- [ ] Diagnose, propose options with a recommendation, wait for the owner's go.

## While building (brief 15.2 to 15.5)
- [ ] Every new route: auth check, role allow-list, ownership check on every record.
- [ ] Input validated on the server; output escaped; SQL bound parameters only.
- [ ] Settings and limits from config or the database, not hardcoded.
- [ ] Reuse an existing helper or class before writing a new one.
- [ ] Migrations additive only; real foreign keys so deletion and export pick up new tables.
- [ ] Any outside script or host added to `buildCsp` on purpose.
- [ ] No em dash characters anywhere.

## Before every push
- [ ] `npm run check` (typecheck, unit tests, inline check)
- [ ] `npm run build:worker`
- [ ] `npm run db:migrate:local`
- [ ] `npx wrangler dev --port 8787`, then `npm run test:e2e` (375 px and 1400 px)
- [ ] New test suites listed in `tests/README.md`
- [ ] `CLAUDE.md`, `HISTORY.md`, `FEATURES.md`, `docs/guides/` updated in the same commit
- [ ] Commit message carries no AI model names
