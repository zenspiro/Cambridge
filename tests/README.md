# Tests

## Unit tests (`tests/unit/`, `npm run test:unit`)
Node's built-in test runner, TypeScript loaded directly. Files must not import Next or Cloudflare modules.

| Suite | Checks |
|---|---|
| `headers.test.ts` | Nonce format, strict production CSP, dev relaxations, bad nonces refused, baseline headers |
| `errors.test.ts` | Error refs are readable and unique; logger never throws; public body has only a reference |
| `migrations.test.ts` | Migrations numbered without gaps; no DROP, RENAME or DELETE |
| `config.test.ts` | Worker, D1 and both R2 buckets bound; no routes; no secrets in vars |
| `check-inline.test.ts` | The inline code scanner catches each banned pattern and passes normal React code |

## Browser smoke test (`tests/e2e/smoke.mjs`, `npm run test:e2e`)
Needs a running Worker (`npx wrangler dev --port 8787`, or set `BASE_URL`). Each page at 375 px and 1400 px: right status, has an h1, no sideways scroll, no script or console errors (CSP violations show here), every script carries the nonce. Add new pages to `PAGES`.
