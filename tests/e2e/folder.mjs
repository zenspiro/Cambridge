// Folder upload against a running Worker: a folder like a Google Drive download, named by its
// folder names, first pages and (locally, without AI) the owner's pick; then uploaded.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePdf } from "../unit/helpers/pdf.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const PASS = readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").match(/^ADMIN_PASS=(.*)$/m)?.[1]?.trim();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const sql = (q) => execFileSync("npx", ["wrangler", "d1", "execute", "cambridge", "--local", "--json", "--command", q], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const rows = (q) => JSON.parse(sql(q))[0].results;

const NAMES = ["0625_s25_qp_32.pdf", "0625_s25_ms_32.pdf", "0625_s25_qp_42.pdf", "0625_s25_ms_21.pdf", "0625_s25_qp_21.pdf", "0625_s25_ci_52.pdf", "0625_s25_sf_51.pdf", "1525_s25_qp_22.pdf", "1530_s25_qp_12.pdf"];
const clean = () => {
  sql(`DELETE FROM source_document WHERE file_name IN (${NAMES.map((n) => `'${n}'`).join(",")})`);
  sql(`DELETE FROM syllabus_alias WHERE code IN ('1525', '1530')`);
};
clean();

// A folder like the unzipped Drive download.
const root = mkdtempSync(join(tmpdir(), "folder-e2e-"));
const june = join(root, "IGCSE Physics (0625)", "2025", "May June");
mkdirSync(june, { recursive: true });
const tag = () => `e2e ${Date.now()} ${Math.random()}`;
const fake = () => `%PDF-1.4\n% ${tag()}\n%%EOF`;
const qp32 = fake();
writeFileSync(join(june, "Question Paper 32.pdf"), qp32); // folder names
writeFileSync(join(june, "Mark Scheme Paper 3 Variant 2.pdf"), fake()); // folder names
writeFileSync(join(june, "Scan 7.pdf"), makePdf(["Cambridge IGCSE", "PHYSICS 0625/42", "Paper 4 Theory (Extended) May/June 2025", "You must answer on the question paper.", tag()], { compress: true })); // first page
writeFileSync(join(june, "Question Paper 21.pdf"), makePdf(["Cambridge IGCSE", "PHYSICS 0625/21", "Paper 2 May/June 2025", "MARK SCHEME", tag()], { compress: true, type0: true })); // first page wins
writeFileSync(join(june, "Revision notes.pdf"), fake()); // nobody can tell: the owner picks
writeFileSync(join(june, "Teacher notes.docx"), "not a pdf");
writeFileSync(join(june, "Question Paper 32 copy.pdf"), qp32); // an identical copy in the folder
// A Cambridge code the library has no name for: stored as it is, whatever the cover says.
// A cover with a code the library does not have next to a library subject (like Pakistan's 1524).
// A Cambridge name with a code the library does not have, in a Physics folder: linked from the folder.
writeFileSync(join(june, "1530_s25_qp_12.pdf"), fake());
writeFileSync(join(june, "Scan 9.pdf"), makePdf(["Cambridge IGCSE", "CHEMISTRY 1525/22", "Paper 2 Multiple Choice (Extended) May/June 2025", "You must answer on the multiple choice answer sheet.", tag()], { compress: true }));
writeFileSync(join(june, "0625_s25_sf_51.pdf"), makePdf(["PHYSICS 0625/51", "Paper 5 Practical Test May/June 2025", "INSTRUCTIONS", tag()]));
// An old year (the Drive copies go back to 2002): left out by its names, never read or sent to the AI.
mkdirSync(join(root, "IGCSE Physics (0625)", "2002"), { recursive: true });
writeFileSync(join(root, "IGCSE Physics (0625)", "2002", "0625_w02_ab_5.pdf"), makePdf(["PHYSICS 0625/05", "ANSWER BOOKLET", "OCTOBER/NOVEMBER SESSION 2002", tag()]));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "cf-connecting-ip": `203.0.113.${1 + Math.floor(Math.random() * 250)}` } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/503|Service Unavailable/.test(m.text())) errors.push(m.text()); });
await page.goto(BASE + "/admin/login");
await page.fill("#password", PASS);
await page.click("button[type=submit]");
await page.waitForURL(BASE + "/admin");

await page.goto(BASE + "/admin/library/upload");
check((await page.locator("a[href='/admin/library/folder']").count()) === 1, "folder: linked from the upload page");
await page.goto(BASE + "/admin/library/folder?code=0625");
// One card: the subject picker and the folder together; changing the subject needs no button.
check((await page.locator("#folder-card #folder-code").count()) === 1 && (await page.locator("#folder-card #folder").count()) === 1 && (await page.locator("form[action='/admin/library/folder']").count()) === 0,
  "folder: subject and folder are picked in one card");
await page.selectOption("#folder-code", "0620");
await page.waitForURL(/code=0620/);
await page.selectOption("#folder-code", "0625");
await page.waitForURL(/code=0625/);
check(await page.locator("#folder-code").inputValue() === "0625", "folder: choosing a subject switches straight away");
await page.setInputFiles("#folder", root);
await page.waitForSelector("#folder-plan", { timeout: 30_000 });
const text = await page.locator("main").innerText();
check(/What is in the folder: 10 PDFs/.test(text) && /1 file is not a PDF and was left out/.test(text), "folder: PDFs found, other files left out");
const toUpload = page.locator("#plan-new li");
check((await toUpload.count()) === 7, `folder: seven files to upload (${await toUpload.count()})`);
check(/1525 is the Other series code of IGCSE Chemistry \(0620\)/.test(await page.locator("#folder-learned").innerText()) && /1530 is the Other series code of IGCSE Physics \(0625\)/.test(await page.locator("#folder-learned").innerText()) && (await page.locator("#plan-new li", { hasText: "1525_s25_qp_22.pdf" }).count()) === 1,
  "folder: unknown codes are linked by themselves, from a first page (1525) and from the folder (1530)");
check((await page.locator("#plan-new li", { hasText: "Scan 7.pdf" }).locator("text=Worked out from its first page.").count()) === 1, "folder: an unnamed file is named from its first page");
check((await page.locator("#plan-new li", { hasText: "0625_s25_ms_21.pdf" }).locator("text=The file name said 0625_s25_qp_21.pdf").count()) === 1, "folder: the first page wins over a wrong name");
check((await page.locator("#plan-duplicate li").count()) === 1 && (await page.locator("#plan-duplicate li", { hasText: "A copy of" }).count()) === 1, "folder: the same file twice is uploaded once, and the page says which file is kept");
check((await page.locator("#plan-new li", { hasText: "Paper 4 Theory (Extended)" }).count()) === 1, "folder: files are described with their paper names");
check((await page.locator("#plan-outside li", { hasText: "0625_w02_ab_5.pdf" }).locator("text=From 2002 the library does not keep").count()) === 1, "folder: an old year is left out by its name, not read");
check(/AI today: \d+ question/.test(await page.locator(".ai-meter").innerText()), "AI meter: shown at the top of the page");
check(/AI is not available here/.test(text), "folder: says when the AI could not help");
const notes = page.locator("#plan-review li", { hasText: "Revision notes.pdf" });
check((await notes.count()) === 1, "folder: an unclear file needs your eye");
check((await page.locator("#plan-new li", { hasText: "0625_s25_sf_51.pdf" }).locator("text=source files").count()) === 1 && (await page.locator("#plan-new li", { hasText: "0625_s25_sf_51.pdf" }).locator("text=Its file name already says what it is.").count()) === 1, "folder: another Cambridge code is uploaded as it is, never read as a question paper");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#folder-report")]);
const csv = readFileSync(await dl.path(), "utf8");
check(dl.suggestedFilename() === "folder-report-0625.csv" && /"Folder path","File","Result"/.test(csv) && /"Revision notes.pdf","Needs your eye"/.test(csv) && csv.split("\r\n").length === 11,
  `folder: Download report gives every file and what happened to it (${csv.split("\r\n").length - 1} rows)`);
const pickText = await notes.locator("select option[value='0625_s25_ci_52.pdf']").innerText();
check(pickText.startsWith("IGCSE Physics (0625) / 2025 / Jun / 0625_s25_ci_52.pdf"), `folder: the picker shows the full place in the library (${pickText})`);
await notes.locator("select").selectOption("0625_s25_ci_52.pdf");
check((await notes.locator(".pick-line", { hasText: "Goes to IGCSE Physics (0625) / 2025 / Jun / 0625_s25_ci_52.pdf" }).count()) === 1, "folder: the picker sits on its own line and says where the file goes");
const box = await notes.locator("select").boundingBox();
const row = await notes.boundingBox();
check(box && row && box.width > row.width * 0.6, `folder: the picker is wide enough to read (${Math.round(box?.width ?? 0)} of ${Math.round(row?.width ?? 0)} px)`);
// Cloudflare hiccups: every file's first try gets an error page (retried by itself), and one file
// keeps failing until "Try again" is pressed.
const tried = new Set();
let holdBack = true;
await page.route("**/admin/library/folder/file", async (route) => {
  const name = route.request().headers()["x-file-name"];
  if (!tried.has(name) || (holdBack && name === "0625_s25_qp_42.pdf")) {
    tried.add(name);
    return route.fulfill({ status: 503, contentType: "text/html", body: "<html>Worker exceeded resource limits</html>" });
  }
  return route.continue();
});
await page.click("button:has-text('Upload 8 files')");
await page.waitForSelector("#folder-done", { timeout: 90_000 });
const doneText = await page.locator("#folder-done").innerText();
check(/7 files stored, 1 not stored/.test(doneText) && /error 503, tried 4 times/.test(doneText), `folder: error pages are retried by themselves, and a file that keeps failing says why (${doneText.split("\n")[1]})`);
holdBack = false;
await page.click("#folder-retry");
await page.waitForSelector("#folder-retry", { state: "detached", timeout: 60_000 });
await page.unroute("**/admin/library/folder/file");
check(/8 files stored/.test(await page.locator("#folder-done").innerText()) && (await page.locator("#folder-done a", { hasText: "Open IGCSE Physics (0625) in the library" }).count()) === 1,
  "folder: after Try again, all eight stored and the summary says so, with a link to the library");
const stored = rows(`SELECT file_name FROM source_document WHERE file_name IN (${NAMES.map((n) => `'${n}'`).join(",")}) ORDER BY file_name`).map((r) => r.file_name);
check(stored.join(",") === "0625_s25_ci_52.pdf,0625_s25_ms_21.pdf,0625_s25_ms_32.pdf,0625_s25_qp_32.pdf,0625_s25_qp_42.pdf,0625_s25_sf_51.pdf,1525_s25_qp_22.pdf,1530_s25_qp_12.pdf", `folder: eight files stored under their worked out names (${stored.join(",")})`);

// Picking the same folder again: everything is already in the library.
await page.goto(BASE + "/admin/library/folder?code=0625");
await page.setInputFiles("#folder", root);
await page.waitForSelector("#folder-plan", { timeout: 30_000 });
check((await page.locator("#plan-have li").count()) === 8 && (await page.locator("#plan-outside li").count()) === 1 && (await page.locator("text=Nothing new to upload").count()) === 1, "folder: a second pick skips files already stored");
check(errors.length === 0, `folder: no script or CSP errors${errors.length ? ": " + errors.join(" | ") : ""}`);

clean();
await browser.close();
if (failures) {
  console.log(`${failures} folder check(s) failed`);
  process.exit(1);
}
