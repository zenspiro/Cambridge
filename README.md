# Cambridge exam prep

Exam practice for Cambridge IGCSE, O Level and A Level students: original questions, AI marking, progress tracking. Product brief: `docs/BRIEF.md`.

## Run it locally

Needs Node 22 or newer.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`npm run dev` is the fast Next.js dev server with local D1 and R2. To run the real Worker build:

```bash
npm run build:worker
npx wrangler dev --local --port 8787
```

Then open http://localhost:8787, http://localhost:8787/health and http://localhost:8787/admin (local password in `.dev.vars`).

## Scripts

| Script | What it does |
|---|---|
| `npm run typecheck` | Generates binding types, then runs TypeScript |
| `npm run test:unit` | Unit tests (Node's built-in test runner) |
| `npm run check:inline` | Blocks inline styles, handlers, raw HTML and similar in `src/` |
| `npm run check` | The three above |
| `npm run build:worker` | Builds the Worker into `.open-next/` |
| `npm run test:e2e` | Browser smoke test against a running Worker (`BASE_URL`, default port 8787) |
| `npm run db:migrate:local` | Applies migrations to the local D1 |

## Deploys

GitHub Actions (`.github/workflows/ci.yml`). Pull requests run the checks. A push to `main` runs the checks, then production migrations, then the deploy, then a health check. Needs the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and the Worker secrets `ADMIN_PASS`, `GITHUB_TOKEN` and `AGENT_SECRET` (set in the Cloudflare dashboard as Secrets), plus the GitHub secret `AGENT_SECRET`. Setup: `docs/guides/agent-setup.md`.

The download agent runs in `.github/workflows/agent.yml`, started only from the admin panel.
