// Fails the build if banned front-end patterns appear in src/ (brief 15.2 and 15.4).
// Counts per rule may never grow past scripts/inline-baseline.json (all zero today).
// React props such as onClick are fine: React attaches those listeners from script.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const RULES: ReadonlyArray<{ id: string; why: string; re: RegExp }> = [
  { id: "style-attr", why: "inline style (use a class in globals.css)", re: /\bstyle\s*=\s*[{"']/g },
  { id: "html-handler", why: "inline HTML event handler", re: /\son[a-z]+\s*=\s*["']/g },
  { id: "raw-html", why: "raw HTML injection", re: /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\b/g },
  { id: "eval", why: "eval or new Function", re: /\beval\s*\(|new\s+Function\s*\(/g },
  { id: "inline-script", why: "inline or outside script tag", re: /<script\b|from\s+["']next\/script["']/g },
  { id: "browser-dialog", why: "browser dialog (use an inline Yes / Never mind confirm)", re: /(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\s*\(/g },
];

export function scan(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of RULES) out[r.id] = (text.match(r.re) ?? []).length;
  return out;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(name)) out.push(p);
  }
  return out;
}

function main(): void {
  const root = new URL("..", import.meta.url).pathname;
  const baseline = JSON.parse(readFileSync(join(root, "scripts/inline-baseline.json"), "utf8")) as Record<string, number>;
  const totals: Record<string, number> = {};
  const hits: string[] = [];
  for (const f of files(join(root, "src"))) {
    const counts = scan(readFileSync(f, "utf8"));
    for (const [id, n] of Object.entries(counts)) {
      totals[id] = (totals[id] ?? 0) + n;
      if (n > 0) hits.push(`  ${relative(root, f)}: ${id} x${n}`);
    }
  }
  let failed = false;
  for (const r of RULES) {
    const n = totals[r.id] ?? 0;
    const max = baseline[r.id] ?? 0;
    if (n > max) {
      failed = true;
      console.error(`check:inline: ${r.id} (${r.why}) count ${n} is above the baseline ${max}`);
    } else if (n < max) {
      console.log(`check:inline: ${r.id} dropped to ${n}; lower the baseline in scripts/inline-baseline.json`);
    }
  }
  if (failed) {
    console.error(hits.join("\n"));
    process.exit(1);
  }
  console.log("check:inline: ok");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
