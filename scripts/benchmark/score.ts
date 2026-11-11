// Scores the stored readings of the benchmark papers against their answer keys (docs/benchmark.md).
//   node scripts/benchmark/score.ts                  live readings, read only (dev session: the Cloudflare API)
//   node scripts/benchmark/score.ts --dir <folder>   readings saved as <folder>/<file>.json instead
//   --save-baseline   keep this run as benchmark/baseline.json (only when it beats the last one)
//   --show-locked     list the locked papers' checks too (never while tuning rules)
// Live needs CF_ACCOUNT_ID, CF_D1_ID and either CF_API_TOKEN or a session whose proxy adds the token. It only reads:
// one D1 query for the papers' ids, then each paper's content.json from the FILES bucket.
// Exit code 1 when a check that passed in the baseline fails now on the tuning set (a regression).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPaper } from "../../src/lib/brain/paper.ts";
import { BENCHMARK, benchCode, benchFileName, regressions, scoreReading, totals, type BenchKey, type BenchRun } from "../../src/lib/brain/benchmark.ts";

const ROOT = new URL("../../benchmark/", import.meta.url).pathname;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dir = arg("--dir");
const showLocked = process.argv.includes("--show-locked");
const saveBaseline = process.argv.includes("--save-baseline");

const api = async (path: string, init?: RequestInit): Promise<Response> => {
  const account = process.env.CF_ACCOUNT_ID;
  if (!account) throw new Error("CF_ACCOUNT_ID is not set");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CF_API_TOKEN) headers.authorization = `Bearer ${process.env.CF_API_TOKEN}`;
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...init, headers });
};

/** Each benchmark file's stored reading, or null when it has none yet. */
async function readings(): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  if (dir) {
    for (const p of BENCHMARK) {
      const at = join(dir, `${p.file}.json`);
      if (existsSync(at)) out.set(p.file, JSON.parse(readFileSync(at, "utf8")));
    }
    return out;
  }
  const d1 = process.env.CF_D1_ID;
  if (!d1) throw new Error("CF_D1_ID is not set");
  const names = BENCHMARK.map(benchFileName);
  const sql = `SELECT d.id, d.file_name FROM source_document d JOIN paper_read r ON r.doc_id = d.id WHERE d.status = 'stored' AND d.file_name IN (${names.map(() => "?").join(",")})`;
  const res = await api(`/d1/database/${d1}/query`, { method: "POST", body: JSON.stringify({ sql, params: names }) });
  const body = (await res.json()) as { success: boolean; result?: { results: { id: string; file_name: string }[] }[]; errors?: unknown };
  if (!body.success) throw new Error(`D1 query failed: ${JSON.stringify(body.errors)}`);
  for (const row of body.result?.[0]?.results ?? []) {
    const r = await api(`/r2/buckets/cambridge/objects/papers/${row.id}/content.json`);
    if (r.ok) out.set(row.file_name.replace(/\.pdf$/, ""), await r.json());
  }
  return out;
}

const keys = new Map<string, BenchKey>();
for (const p of BENCHMARK) {
  const at = join(ROOT, "keys", `${p.file}.json`);
  if (existsSync(at)) keys.set(p.file, JSON.parse(readFileSync(at, "utf8")) as BenchKey);
  else console.warn(`no key for ${p.file}`);
}

const got = await readings();
const run: BenchRun = {};
for (const [file, key] of keys) {
  const raw = got.get(file);
  if (raw == null) continue;
  run[file] = scoreReading(key, cleanPaper(raw, key.kind));
}

const locked = new Set(BENCHMARK.filter((p) => p.locked).map((p) => p.file));
const tuning = BENCHMARK.filter((p) => !p.locked).map((p) => p.file);
const line = (label: string, t: ReturnType<typeof totals>) =>
  `${label.padEnd(22)} ${String(t.read).padStart(2)} of ${String(t.papers).padStart(2)} read  ${String(t.right).padStart(2)} fully right  ${t.pct.toFixed(1).padStart(5)}% of ${t.total} checks`;

console.log("Tuning set, paper by paper:");
for (const f of tuning) {
  const s = run[f];
  if (!s) {
    console.log(`  ${f.padEnd(16)} not read yet`);
    continue;
  }
  const bad = s.checks.filter((c) => !c.ok);
  console.log(`  ${f.padEnd(16)} ${s.pct.toFixed(1).padStart(5)}%  ${s.passed}/${s.total}${bad.length ? `  wrong: ${bad.slice(0, 8).map((c) => `${c.id}${c.why ? ` (${c.why})` : ""}`).join(", ")}${bad.length > 8 ? `, and ${bad.length - 8} more` : ""}` : ""}`);
}
if (showLocked) {
  console.log("Locked set (shown on request only):");
  for (const f of locked) {
    const s = run[f];
    console.log(`  ${f.padEnd(16)} ${s ? `${s.pct.toFixed(1)}%  ${s.checks.filter((c) => !c.ok).map((c) => c.id).join(", ")}` : "not read yet"}`);
  }
}
console.log("\nBy subject (tuning set):");
for (const code of [...new Set(BENCHMARK.map((p) => benchCode(p.file)))]) console.log(`  ${line(code, totals(run, tuning.filter((f) => benchCode(f) === code)))}`);
console.log("");
console.log(line("Tuning set", totals(run, tuning)));
console.log(line("Locked set", totals(run, [...locked])));

const basePath = join(ROOT, "baseline.json");
const base = existsSync(basePath) ? (JSON.parse(readFileSync(basePath, "utf8")) as BenchRun) : null;
let failed = false;
if (base) {
  const tuningBase = Object.fromEntries(Object.entries(base).filter(([f]) => !locked.has(f)));
  const lost = regressions(tuningBase, run);
  const before = totals(base, tuning);
  const now = totals(run, tuning);
  console.log(`\nAgainst the baseline: tuning set ${before.pct.toFixed(1)}% then, ${now.pct.toFixed(1)}% now; locked set ${totals(base, [...locked]).pct.toFixed(1)}% then, ${totals(run, [...locked]).pct.toFixed(1)}% now.`);
  if (lost.length) {
    failed = true;
    console.log(`${lost.length} check${lost.length === 1 ? "" : "s"} that passed now fail:`);
    for (const r of lost.slice(0, 40)) console.log(`  ${r.file} ${r.id}`);
  } else console.log("Nothing that passed before fails now.");
}
writeFileSync(join(ROOT, "latest.json"), `${JSON.stringify(run)}\n`);
if (saveBaseline) {
  if (failed) console.log("\nNot saved as the baseline: fix the regressions first.");
  else {
    writeFileSync(basePath, `${JSON.stringify(run)}\n`);
    console.log("\nSaved as the baseline.");
  }
}
process.exit(failed ? 1 : 0);
