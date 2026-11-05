// Brand page (admin, 1400 px) and the theme gallery: switching themes without a reload, and the student frame at
// 375 px in every theme. Uses the local .dev.vars password, never a real one.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PASS = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
if (!PASS) throw new Error("ADMIN_PASS missing from .dev.vars");

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};
const net = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
// A real 1 by 1 pixel PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE + "/admin/login");
await page.fill("#password", PASS);
await page.click("button[type=submit]");
await page.waitForURL(BASE + "/admin");

// Brand: wording saves in place and shows in the page title.
await page.goto(BASE + "/admin/brand");
const original = await page.inputValue("input[name=name]");
await page.evaluate(() => { window.__noReload = true; });
await page.fill("input[name=name]", "E2E Prep Hub");
await page.click("form[action='/admin/brand/save'] button[type=submit]");
await page.waitForSelector("text=Saved. Every page uses the new wording now.");
check(await page.evaluate(() => window.__noReload === true), "brand: saving does not reload the page");
await page.goto(BASE + "/admin/brand");
check((await page.title()).includes("E2E Prep Hub"), "brand: the new name is in the page title");

// Pictures: SVG refused, PNG stored and served with a long cache, then removed with the inline confirm.
const logoForm = page.locator("#brand-logo form[action='/admin/brand/image']");
await logoForm.locator("input[type=file]").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG });
await logoForm.locator("button[type=submit]").click();
await page.waitForSelector("#brand-logo >> text=SVG files are not accepted");
check(true, "brand: an SVG logo is refused");
await logoForm.locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
await logoForm.locator("button[type=submit]").click();
await page.waitForSelector("#brand-logo img.brand-img-logo");
const src = await page.locator("#brand-logo img.brand-img-logo").getAttribute("src");
const img = await page.request.get(BASE + src);
check(img.status() === 200 && img.headers()["content-type"] === "image/png", "brand: the logo is served as a PNG");
check((img.headers()["cache-control"] ?? "").includes("immutable"), "brand: the logo is cached for a long time");
check((await page.request.get(BASE + "/brand/logo-0000000000000000.png")).status() === 404, "brand: unknown or old files are not served");
await page.goto(BASE + "/admin/themes/phone");
check((await page.locator(".s-top img.s-logo").count()) === 1, "brand: the student frame shows the uploaded logo");
await page.goto(BASE + "/admin/brand");
await page.locator("#brand-logo form[action='/admin/brand/remove'] button[type=submit]").click();
await page.locator("#brand-logo .confirm >> text=Yes").click();
await page.waitForSelector("#brand-logo >> text=Not set");
check(true, "brand: removing the logo asks inline and works without a reload");

// Put the name back for the other tests.
await page.fill("input[name=name]", original);
await page.click("form[action='/admin/brand/save'] button[type=submit]");
await page.waitForSelector("text=Saved. Every page uses the new wording now.");

// Gallery at desktop: the theme switch works in place.
await page.goto(BASE + "/admin/themes");
await page.evaluate(() => { window.__noReload = true; });
const phone = page.getByTestId("gallery-phone");
await phone.getByRole("button", { name: "Playful" }).click();
check((await phone.locator(".s-app").getAttribute("data-theme")) === "b", "gallery: Playful switches the theme");
check(await page.evaluate(() => window.__noReload === true), "gallery: switching does not reload the page");
await phone.getByRole("button", { name: "2 A" }).click();
check(await phone.getByText("Where you lost the mark").waitFor({ timeout: 10_000 }).then(() => true, () => false), "gallery: a wrong answer shows where the mark was lost");
check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "gallery: no sideways scroll at 1400 px");
check(errors.length === 0, `admin pages: no script or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);

// The student frame on a 375 px phone, in every theme.
const cookies = await ctx.cookies();
for (const theme of ["a", "b", "c"]) {
  const pctx = await browser.newContext({ viewport: { width: 375, height: 800 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
  await pctx.addCookies(cookies);
  const p = await pctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.goto(`${BASE}/admin/themes/phone?theme=${theme}`, { waitUntil: "networkidle" });
  check((await p.locator(".s-app").getAttribute("data-theme")) === theme, `375px theme ${theme}: the theme is applied`);
  check(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `375px theme ${theme}: no sideways scroll`);
  const navBox = await p.locator(".s-nav").boundingBox();
  check(navBox && navBox.y + navBox.height <= 800 + 1 && navBox.y > 600, `375px theme ${theme}: the menu sits at the bottom of the screen`);
  check((await p.locator(".s-footer").textContent())?.includes("not affiliated"), `375px theme ${theme}: the footer statement shows`);
  const font = await p.evaluate(() => document.fonts.check("16px " + getComputedStyle(document.querySelector(".s-app")).fontFamily.split(",")[0]));
  check(font, `375px theme ${theme}: the theme's own font is loaded`);
  check(errs.length === 0, `375px theme ${theme}: no script or CSP errors${errs.length ? ": " + errs.join(" | ") : ""}`);
  await pctx.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
