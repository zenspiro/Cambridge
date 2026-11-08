# Handover: picking up this project in a new Claude session

For any Claude session (any account) that continues the work. Read this, then `CLAUDE.md`, `docs/BRIEF.md` and
`docs/PLAN.md`. Last updated 8 Nov 2026.

## Where things stand
- Phase 1 is done. Phase 2 step 1 (topic tree) and step 2a are live. Step 2b (reading papers) is built and in use.
- The first real paper, 0625_w25_qp_42 (IGCSE Physics, November 2025, Paper 4, variant 2), was read and reviewed
  by the owner on 7 Nov 2026.
- Built in the last session (7 to 8 Nov 2026), newest first; see `HISTORY.md` for details:
  - Read accuracy badge (red, amber or green) per paper; Yes, proceed / No confirms on the reading buttons.
  - "Cut figures from the PDF (free)" button.
  - Figures cut from the PDF as SVG by code (Poppler), no drawing AI; "Adjust box" panel to draw a box by hand.
  - Flag list on the review screen (filters, J/K keys, fix-and-next, page remembered).
  - Session page "Read and review" list with Review buttons.
- Check whether the last commit on the branch is merged into `main`; if not, the owner opens the pull request.

## What is next (owner's order)
1. Owner tests the mark scheme: reads 0625_w25_ms_42 and reviews it (marks are checked against its question paper).
2. "Read all" for a session, then a subject: one button, total rough cost first, stops at the monthly cap, skips
   papers already read, progress per paper. Plan it first and dry run the cost (owner's dry-run rule), then build.
   `docs/PLAN.md` mentions Anthropic's batch service (half price) for whole subjects.
3. Step 2c: examiner reports, grade thresholds, blueprints, topic frequency.
4. Admin UI/UX overhaul (back burner, but must be done before any student or parent page).

## How the owner works (from `CLAUDE.md`, the important parts)
- Short, humanized bullet replies, one topic or step at a time. Never the em dash character, anywhere.
- Plan first with options and a recommendation; code only after "go", "start" or "proceed".
- Never open a pull request unless asked; the owner opens and merges them. Never ask for secret values.
- Commits carry no AI model names.
- Dry run before spending: any paid AI job is first run in the dev session on a real example (the session's own
  reading stands in for the paid answer), with screenshots, token and cost estimates, before the owner pays.
- Admin is desktop only (1400 px); nothing below 14 px.

## Git workflow
- Work on the branch the session is given. After the owner merges, start again from the latest `main`
  (`git fetch origin main && git checkout -B <branch> origin/main`). Never force push.
- Before every push, all of these:
  1. `npm run check` (typecheck, unit tests, inline check) and read its exit code.
  2. `npm run build:worker`.
  3. A fresh local database: `rm -rf .wrangler`, `cp .dev.vars.example .dev.vars` (back up a real `.dev.vars` first
     and put it back after), `npm run db:migrate:local`.
  4. `npx wrangler dev --local --port 8787` in the background, then `NODE_USE_ENV_PROXY=1 npm run test:e2e`.
  5. Stop the servers: `pkill -f wrangler; pkill -f workerd`.
- Update `CLAUDE.md`, `HISTORY.md`, `FEATURES.md` (and the guides when relevant) in the same commit as the code.
- The browser suite needs Poppler (`pdftocairo`, `pdftotext`); CI installs it, a dev container may need
  `apt-get install poppler-utils`.

## Things that are not in the repo
- The owner's sample papers used for dry runs (Physics 0625_w25_qp_42, Maths 0580 specimen and w25 papers, Computer
  Science 0478 papers) lived in the old session's scratch folder. Ask the owner to upload them again when a dry run
  needs them. Never commit Cambridge papers or artwork to the repo.
- Secrets live in GitHub Actions secrets and the Cloudflare Worker, not in any Claude account, so a new account
  changes nothing there.

## Two Claude accounts at once
- Both accounts work on the same GitHub repository, so there is no conflict as long as one session works on a
  change at a time, and each new session starts from the latest `main`.
- Each session gets its own branch name, so pushes never collide. A conflict only happens if two open branches edit
  the same files; then the second pull request needs the first one merged into it before it can be merged.
- Simple rule: merge one session's pull request before starting the next session's work.
