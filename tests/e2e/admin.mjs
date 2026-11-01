// Browser test of admin sign-in against a running Worker (default http://localhost:8787).
// Reads the local password from .dev.vars (ADMIN_PASS), never a real one.
import { chromium, request as apiRequest } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PASS = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
if (!PASS) throw new Error("ADMIN_PASS missing from .dev.vars");

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};
// Each run uses its own made-up network, so lockouts never leak between runs.
const net = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

const browser = await chromium.launch();
for (const width of [375, 1400]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, extraHTTPHeaders: { "cf-connecting-ip": net() } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/admin");
  check(page.url().endsWith("/admin/login"), `${width}px signed out: /admin goes to sign-in`);

  await page.fill("#password", "definitely wrong");
  await page.click("button[type=submit]");
  check((await page.locator("p.alert").textContent())?.includes("not right"), `${width}px wrong password shows a message`);

  await page.fill("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL(BASE + "/admin");
  check((await page.locator("h1").textContent()) === "Admin", `${width}px right password opens the admin page`);
  check((await page.locator(".list-row").first().textContent())?.includes("Signed in"), `${width}px activity shows the sign-in`);

  const cookie = (await ctx.cookies()).find((c) => c.name === "__Host-admin");
  check(cookie?.httpOnly && cookie.secure && cookie.sameSite === "Strict" && !cookie.domain.startsWith("."), `${width}px cookie is HttpOnly, Secure, SameSite=Strict, no Domain`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, `${width}px no sideways scroll`);

  await page.click("text=Sign out");
  await page.waitForURL(/\/admin\/login$/);
  await page.goto(BASE + "/admin");
  check(page.url().endsWith("/admin/login"), `${width}px after sign-out /admin is closed again`);

  // An old token must not work after sign-out.
  if (cookie) {
    await ctx.addCookies([{ ...cookie }]);
    await page.goto(BASE + "/admin");
    check(page.url().endsWith("/admin/login"), `${width}px replayed old cookie is refused`);
  }
  check(errors.length === 0, `${width}px no script or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

// Attacker checks without a browser.
const api = await apiRequest.newContext({ baseURL: BASE, maxRedirects: 0 });
const cross = await api.post("/admin/session", { form: { password: PASS }, headers: { origin: "https://evil.example" } });
check(cross.status() === 403, "cross-site sign-in POST is refused");
const noOrigin = await api.post("/admin/session", { form: { password: PASS } });
check(noOrigin.status() === 403, "sign-in POST without Origin is refused");
const forged = await api.get("/admin", { headers: { cookie: "__Host-admin=forgedtoken123" } });
check(forged.status() === 307 || forged.status() === 303 || (forged.headers()["location"] ?? "").includes("/admin/login"), "forged cookie gets no admin page");

const ip = net();
let last;
for (let i = 0; i < 6; i++) {
  last = await api.post("/admin/session", { form: { password: i < 5 ? "wrong" : PASS }, headers: { origin: BASE, "cf-connecting-ip": ip } });
}
check((last?.headers()["location"] ?? "").endsWith("e=locked"), "6th try is locked, even with the right password");
const other = await api.post("/admin/session", { form: { password: PASS }, headers: { origin: BASE, "cf-connecting-ip": net() } });
check(other.headers()["location"]?.endsWith("/admin") && (other.headers()["set-cookie"] ?? "").includes("__Host-admin="), "another network can still sign in");

await api.dispose();
await browser.close();
process.exit(failures ? 1 : 0);
