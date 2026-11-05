// Student themes (owner decision 5 Nov 2026): each theme sets every token, text is readable (WCAG AA), nothing
// below 14 px, and the theme list in config matches the stylesheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PARENT_THEME, THEMES } from "../../src/lib/config.ts";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function themeTokens(id: string): Record<string, string> {
  const m = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(m, `theme ${id} has a token block`);
  const out: Record<string, string> = {};
  for (const x of (m[1] ?? "").matchAll(/(--t-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[x[1] ?? ""] = (x[2] ?? "").trim();
  return out;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is a 6-digit hex colour`);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt((m[1] ?? "").slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string | undefined, b: string | undefined) => {
  const [x = 0, y = 0] = [luminance(a ?? ""), luminance(b ?? "")].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("every theme in config has a token block, and they all set the same tokens", () => {
  const sets = THEMES.map((t) => Object.keys(themeTokens(t.id)).sort());
  assert.ok((sets[0] ?? []).length >= 30);
  for (const s of sets) assert.deepEqual(s, sets[0]);
  assert.ok(THEMES.some((t) => t.id === PARENT_THEME));
});

// Text colour on background colour, each needs 4.5:1 (normal text). Subject colours are large bold text: 3:1.
const TEXT_PAIRS = [
  ["--t-ink", "--t-ground"], ["--t-ink", "--t-surface"], ["--t-ink", "--t-surface-2"],
  ["--t-muted", "--t-ground"], ["--t-muted", "--t-surface"], ["--t-muted", "--t-surface-2"],
  ["--t-accent-ink", "--t-accent"], ["--t-feature-ink", "--t-feature"],
  ["--t-good-ink", "--t-good-wash"], ["--t-ink", "--t-good-wash"],
  ["--t-bad-ink", "--t-bad-wash"], ["--t-ink", "--t-bad-wash"],
  ["--t-hint-ink", "--t-hint-wash"], ["--t-accent-text", "--t-surface"], ["--t-accent-text", "--t-ground"],
] as const;

for (const t of THEMES) {
  test(`theme ${t.label}: text pairs pass WCAG AA`, () => {
    const k = themeTokens(t.id);
    for (const [fg, bg] of TEXT_PAIRS) {
      const r = contrast(k[fg], k[bg]);
      assert.ok(r >= 4.5, `${t.label}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
    }
    for (let i = 1; i <= 6; i++) {
      const s = k[`--t-subj-${i}`];
      assert.ok(contrast(s, k["--t-surface"]) >= 3, `${t.label}: subject ${i} on cards`);
      assert.ok(contrast(k["--t-ground"], s) >= 3, `${t.label}: badge number on subject ${i}`);
    }
  });
}

test("no student or parent text is smaller than 14 px", () => {
  const start = css.indexOf("/* Student and parent building blocks");
  assert.ok(start > 0);
  for (const [, px] of css.slice(start).matchAll(/font-size:\s*(\d+)px/g)) assert.ok(Number(px) >= 14, `font-size ${px}px`);
});

test("fonts are our own copies, never from another host", () => {
  for (const [, url] of css.matchAll(/url\("([^"]+)"\)/g)) assert.match(url ?? "", /^\/fonts\/[a-z0-9-]+\.woff2$/);
});
