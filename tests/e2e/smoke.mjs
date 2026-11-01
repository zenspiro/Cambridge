// Browser smoke test against a running Worker (default http://localhost:8787).
// Checks every page at 375 px and 1400 px: loads, no sideways scroll,
// no script errors and no CSP violations, nonce on every script.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PAGES = ["/", "/does-not-exist"];
const WIDTHS = [375, 1400];

const browser = await chromium.launch();
let failures = 0;
for (const width of WIDTHS) {
  for (const path of PAGES) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`script error: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
    const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
    const expected = path === "/does-not-exist" ? 404 : 200;
    if (res?.status() !== expected) problems.push(`status ${res?.status()} (expected ${expected})`);
    if (!(await page.locator("h1").count())) problems.push("no h1");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) problems.push("sideways scroll");
    const bare = await page.evaluate(() => [...document.scripts].filter((s) => !s.nonce && s.type !== "application/ld+json").length);
    if (bare) problems.push(`${bare} script(s) without nonce`);
    if (path === "/does-not-exist") problems.splice(0, problems.length, ...problems.filter((p) => !p.includes("404")));
    console.log(`${problems.length ? "FAIL" : "ok  "} ${width}px ${path}${problems.length ? "\n  " + problems.join("\n  ") : ""}`);
    failures += problems.length;
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
