import { test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./helpers/d1.ts";
import { signRequest, verifyRequest, MAX_SKEW_MS } from "../../src/lib/agent/sign.ts";
import { parseRobots } from "../../src/lib/agent/robots.ts";
import { extractPdfLinks, toCambridgeName } from "../../src/lib/agent/links.ts";
import { checkRunParams, claimRun, finishRun, startRun, spendNonce, activeRun, recordProgress, cancelRun, closeStaleRuns, cleanEventText, cleanRunUrl, getRun } from "../../src/lib/agent/runs.ts";
import { checkLibrarySettings, getLibrarySettings, saveLibrarySettings, LIBRARY_DEFAULTS } from "../../src/lib/settings.ts";
import { addPage, checkPageUrl, removePage } from "../../src/lib/library/sources.ts";
import { AGENT } from "../../src/lib/config.ts";

const SECRET = "s".repeat(40);
const T = 1_800_000_000_000;
const body = new TextEncoder().encode('{"jobId":"abc"}');

test("signed requests verify; tampering, old clocks and weak secrets fail", async () => {
  const h = new Headers(await signRequest(SECRET, "POST", "/api/agent/job", body, T));
  assert.equal((await verifyRequest(SECRET, "POST", "/api/agent/job", body, h, T + 1000)).ok, true);
  const bad = async (...a: Parameters<typeof verifyRequest>) => (await verifyRequest(...a)) as { ok: boolean; reason?: string };
  assert.equal((await bad(SECRET, "POST", "/api/agent/file", body, h, T)).reason, "signature", "other path");
  assert.equal((await bad(SECRET, "POST", "/api/agent/job", new TextEncoder().encode("{}"), h, T)).reason, "signature", "other body");
  assert.equal((await bad("x".repeat(40), "POST", "/api/agent/job", body, h, T)).reason, "signature", "other secret");
  assert.equal((await bad(SECRET, "POST", "/api/agent/job", body, h, T + MAX_SKEW_MS + 1)).reason, "time");
  assert.equal((await bad("short", "POST", "/api/agent/job", body, h, T)).reason, "secret");
  assert.equal((await bad(undefined, "POST", "/api/agent/job", body, h, T)).reason, "secret");
  assert.equal((await bad(SECRET, "POST", "/api/agent/job", body, new Headers(), T)).reason, "headers");
});

test("nonces are spent once (replay guard)", async () => {
  const db = testDb();
  assert.equal(await spendNonce(db, "n".repeat(30), T), true);
  assert.equal(await spendNonce(db, "n".repeat(30), T + 1), false);
  assert.equal(await spendNonce(db, "m".repeat(30), T + 1), true);
});

test("robots.txt: Cambridge's real rules, groups, longest match, wildcards", () => {
  const cie = parseRobots("User-Agent: *\nDisallow: /search\nDisallow: /Images/cambridge-samples-database.xls\n", "ExamPrepLibraryAgent");
  assert.equal(cie("/Images/570010-june-2024-question-paper-11.pdf"), true);
  assert.equal(cie("/programmes-and-qualifications/cambridge-igcse-physics-0625/past-papers/"), true);
  assert.equal(cie("/search?q=x"), false);
  assert.equal(cie("/Images/cambridge-samples-database.xls"), false);

  const r = parseRobots(
    "User-agent: *\nDisallow: /\n\nUser-agent: examprepLibraryAgent\nDisallow: /private\nAllow: /private/papers/\nDisallow: /*.zip$\n",
    "ExamPrepLibraryAgent",
  );
  assert.equal(r("/public/x.pdf"), true, "our group replaces *");
  assert.equal(r("/private/x.pdf"), false);
  assert.equal(r("/private/papers/x.pdf"), true, "longer allow wins");
  assert.equal(r("/a/b.zip"), false);
  assert.equal(r("/a/b.zip.pdf"), true);
  assert.equal(parseRobots("", "X")("/anything"), true);
  assert.equal(parseRobots("User-agent: *\nDisallow: /\n", "X")("/x"), false);
});

// Real link names seen on Cambridge's 0625 pages on 1 Nov 2026.
const REAL: [string, string | null][] = [
  ["570010-june-2024-question-paper-11.pdf", "0625_s24_qp_11.pdf"],
  ["570004-june-2024-mark-scheme-paper-11.pdf", "0625_s24_ms_11.pdf"],
  ["671387-june-2024-question-paper-61.pdf", "0625_s24_qp_61.pdf"],
  ["649930-june-2024-confidential-instructions-paper-51.pdf", "0625_s24_ci_51.pdf"],
  ["570003-june-2024-examiner-report.pdf", "0625_s24_er.pdf"],
  ["595783-2023-specimen-paper-1.pdf", "0625_y23_sp_1.pdf"],
  ["595771-2023-specimen-paper-1-mark-scheme.pdf", "0625_y23_sm_1.pdf"],
  ["595767-2023-specimen-paper-5-confidential-instructions.pdf", "0625_y23_ci_5.pdf"],
  ["595430-2023-2025-syllabus.pdf", "0625_y23_sy.pdf"],
  ["697209-2026-2028-syllabus.pdf", "0625_y26_sy.pdf"],
  ["604573-2023-2025-syllabus-update.pdf", null],
  ["730281-2023-2025-grade-descriptions.pdf", null],
];

test("Cambridge website names become standard names", () => {
  for (const [file, want] of REAL) {
    assert.equal(toCambridgeName(`https://www.cambridgeinternational.org/Images/${file}`, "0625"), want, file);
  }
  const u = (f: string) => `https://example.org/${f}`;
  assert.equal(toCambridgeName(u("0625_w23_ms_32.pdf"), "0625"), "0625_w23_ms_32.pdf");
  assert.equal(toCambridgeName(u("0620_w23_ms_32.pdf"), "0625"), null, "other syllabus");
  assert.equal(toCambridgeName(u("1-november-2025-grade-thresholds.pdf"), "0625"), "0625_w25_gt.pdf");
  assert.equal(toCambridgeName(u("1-march-2025-question-paper-22.pdf"), "0625"), "0625_m25_qp_22.pdf");
  assert.equal(toCambridgeName(u("1-june-2024-examiner-report-paper-11.pdf"), "0625"), null, "reports have no paper");
  assert.equal(toCambridgeName(u("1-june-2024-question-paper.pdf"), "0625"), null, "papers need a number");
  assert.equal(toCambridgeName(u("..%2F..%2Fetc.pdf"), "0625"), null);
});

test("PDF links: same site only, resolved, no duplicates", () => {
  const html = `<a href="/Images/1-june-2024-question-paper-11.pdf">a</a>
    <a href='/Images/1-june-2024-question-paper-11.pdf#x'>dup</a>
    <a href="https://evil.example/x.pdf">x</a> <a href="//evil.example/y.pdf">y</a>
    <a href="relative/z.PDF">z</a> <a href="/page.html">p</a> <a href="javascript:alert(1)">j</a>`;
  const links = extractPdfLinks(html, "https://www.cambridgeinternational.org/a/b/", "https://www.cambridgeinternational.org/");
  assert.deepEqual(links, [
    "https://www.cambridgeinternational.org/Images/1-june-2024-question-paper-11.pdf",
    "https://www.cambridgeinternational.org/a/b/relative/z.PDF",
  ]);
  assert.deepEqual(extractPdfLinks(html, "https://x.org/a/", "https://x.org/papers/"), []);
});

test("library settings: checked, saved, audited, safe defaults", async () => {
  const db = testDb();
  assert.deepEqual(await getLibrarySettings(db), { fromYear: 2022, toYear: 2026, lastSession: { year: 2026, session: "s" } });
  const ok = { fromYear: 2022, toYear: 2027, lastSession: { year: 2027, session: "m" } };
  assert.deepEqual(checkLibrarySettings(ok), ok);
  for (const bad of [
    { ...ok, fromYear: 2028 }, { ...ok, fromYear: 1990 }, { ...ok, toYear: 2050 }, { ...ok, lastSession: { year: 2030, session: "s" } },
    { ...ok, lastSession: { year: 2026, session: "x" } }, { ...ok, fromYear: 2022.5 }, null, "x",
  ]) assert.equal(checkLibrarySettings(bad), null, JSON.stringify(bad));
  await saveLibrarySettings(db, ok as never, "platform-admin");
  assert.deepEqual(await getLibrarySettings(db), ok);
  db.raw.exec(`UPDATE setting SET value = '{"fromYear":"x"}' WHERE key = 'library'`);
  assert.deepEqual(await getLibrarySettings(db), LIBRARY_DEFAULTS);
  assert.equal((db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'setting.library'").get() as { n: number }).n, 1);
});

test("run choices are checked against the library years", () => {
  const lib = LIBRARY_DEFAULTS;
  assert.deepEqual(checkRunParams({ code: "0625", years: ["2024", "2023"], sessions: ["s", "y"], mode: "dry" }, lib), {
    code: "0625", years: [2024, 2023], sessions: ["s", "y"], mode: "dry",
  });
  for (const bad of [
    { code: "0625", years: [], sessions: ["s"], mode: "dry" },
    { code: "0625", years: ["2024"], sessions: [], mode: "dry" },
    { code: "0625", years: ["2019"], sessions: ["s"], mode: "dry" },
    { code: "0625", years: ["2024", "2019"], sessions: ["s"], mode: "dry" },
    { code: "0625", years: ["2024"], sessions: ["s", "q"], mode: "dry" },
    { code: "0625", years: ["2024"], sessions: ["s"], mode: "delete" },
    { code: "9999", years: ["2024"], sessions: ["s"], mode: "dry" },
  ]) assert.equal(checkRunParams(bad, lib), null, JSON.stringify(bad));
});

test("runs: one at a time, claimed once, finished once, stale runs closed", async () => {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "dry" as const };
  const id = await startRun(db, p, "platform-admin", T);
  assert.ok(id);
  assert.equal(await startRun(db, p, "platform-admin", T + 1), null, "second run refused while one is queued");
  assert.deepEqual(await claimRun(db, id!, T + 2), p);
  assert.deepEqual(await activeRun(db, id!), p);
  assert.equal(await finishRun(db, id!, true, "{}", null, T + 3), true);
  assert.equal(await finishRun(db, id!, true, "{}", null, T + 4), false, "cannot finish twice");
  assert.equal(await claimRun(db, id!, T + 5), null, "finished runs cannot be claimed");

  const stuck = await startRun(db, p, "platform-admin", T + 10);
  assert.ok(stuck);
  const later = T + 10 + AGENT.staleAfterMs + 1;
  const fresh = await startRun(db, p, "platform-admin", later);
  assert.ok(fresh, "stale run no longer blocks");
  const row = db.raw.prepare("SELECT status, error_ref FROM job WHERE id = ?").get(stuck!) as { status: string; error_ref: string };
  assert.deepEqual({ ...row }, { status: "failed", error_ref: "never_started" });
});

test("start pages stay inside their source", async () => {
  assert.equal(checkPageUrl("https://www.cambridgeinternational.org/programmes/x/", "https://www.cambridgeinternational.org/"), "https://www.cambridgeinternational.org/programmes/x/");
  assert.equal(checkPageUrl("https://evil.example/x", "https://www.cambridgeinternational.org/"), null);
  assert.equal(checkPageUrl("https://a.org/other/", "https://a.org/papers/"), null);
  assert.equal(checkPageUrl("http://a.org/papers/", "https://a.org/papers/"), null);
  const db = testDb();
  const pages = () => db.raw.prepare("SELECT COUNT(*) n FROM source_page").get() as { n: number };
  assert.equal(pages().n, 2, "two Cambridge 0625 pages seeded");
  assert.deepEqual(await addPage(db, { siteId: "cambridge-official", url: "https://evil.example/", code: "0625" }, "a"), { ok: false, error: "page_url" });
  assert.deepEqual(await addPage(db, { siteId: "cambridge-official", url: "https://www.cambridgeinternational.org/x/", code: "9999" }, "a"), { ok: false, error: "code" });
  assert.deepEqual(await addPage(db, { siteId: "nope-nope", url: "https://www.cambridgeinternational.org/x/", code: "0625" }, "a"), { ok: false, error: "missing" });
  assert.deepEqual(await addPage(db, { siteId: "cambridge-official", url: "https://www.cambridgeinternational.org/x/", code: "0625" }, "a"), { ok: true });
  assert.deepEqual(await addPage(db, { siteId: "cambridge-official", url: "https://www.cambridgeinternational.org/x/", code: "0625" }, "a"), { ok: false, error: "page_exists" });
  assert.equal(await removePage(db, "cie-0625-overview", "a"), true);
  db.raw.exec("DELETE FROM source_site WHERE id = 'cambridge-official'");
  assert.equal(pages().n, 0, "pages go with their source");
});

test("progress: updates the run, keeps the last events, refuses inactive runs", async () => {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "dry" as const };
  const id = (await startRun(db, p, "a", T))!;
  assert.equal(await recordProgress(db, id, { progress: 5, step: "x", event: "e", runUrl: null }, T + 1), false, "queued runs take no progress");
  await claimRun(db, id, T + 2);
  for (let i = 0; i < AGENT.maxEvents + 5; i++) {
    assert.equal(await recordProgress(db, id, { progress: i * 10, step: `step ${i}`, event: `event ${i}`, runUrl: null }, T + 10 + i), true);
  }
  const run = (await getRun(db, id))!;
  const events = JSON.parse(run.events) as { text: string }[];
  assert.equal(events.length, AGENT.maxEvents);
  assert.equal(events.at(-1)!.text, `event ${AGENT.maxEvents + 4}`);
  assert.equal(run.progress, 99, "capped below 100 until finished");
  assert.equal(run.heartbeat_at, T + 10 + AGENT.maxEvents + 4);
  await recordProgress(db, id, { progress: 50, step: null, event: null, runUrl: "https://github.com/zenspiro/Cambridge/actions/runs/123" }, T + 100);
  assert.equal((await getRun(db, id))!.step, `step ${AGENT.maxEvents + 4}`, "a missing step keeps the last one");
  assert.equal((await getRun(db, id))!.run_url, "https://github.com/zenspiro/Cambridge/actions/runs/123");
  await finishRun(db, id, true, "{}", null, T + 200);
  assert.equal(await recordProgress(db, id, { progress: 1, step: "late", event: null, runUrl: null }, T + 201), false);
});

test("cancel stops a run and the agent's next update is refused", async () => {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "download" as const };
  const id = (await startRun(db, p, "a", T))!;
  await claimRun(db, id, T + 1);
  assert.equal(await cancelRun(db, id, "platform-admin", T + 2), true);
  assert.equal(await cancelRun(db, id, "platform-admin", T + 3), false, "only once");
  assert.equal(await recordProgress(db, id, { progress: 10, step: "x", event: null, runUrl: null }, T + 4), false);
  assert.equal(await activeRun(db, id), null, "file uploads for it are refused");
  assert.equal(await finishRun(db, id, true, "{}", null, T + 5), false);
  assert.equal((await getRun(db, id))!.status, "cancelled");
  assert.ok(await startRun(db, p, "a", T + 6), "a new run can start right away");
});

test("quiet runs close after 15 minutes; never-started runs say so", async () => {
  const db = testDb();
  const p = { code: "0625", years: [2024], sessions: ["s" as const], mode: "dry" as const };
  const never = (await startRun(db, p, "a", T))!;
  await closeStaleRuns(db, T + AGENT.staleAfterMs - 1);
  assert.equal((await getRun(db, never))!.status, "queued", "not yet");
  await closeStaleRuns(db, T + AGENT.staleAfterMs + 1);
  assert.deepEqual([(await getRun(db, never))!.status, (await getRun(db, never))!.error_ref], ["failed", "never_started"]);

  const busy = (await startRun(db, p, "a", T + 1_000_000))!;
  await claimRun(db, busy, T + 1_000_001);
  await recordProgress(db, busy, { progress: 10, step: "x", event: null, runUrl: null }, T + 1_000_000 + AGENT.staleAfterMs);
  await closeStaleRuns(db, T + 1_000_000 + AGENT.staleAfterMs + 10);
  assert.equal((await getRun(db, busy))!.status, "running", "a recent update keeps it alive");
  await closeStaleRuns(db, T + 1_000_000 + 2 * AGENT.staleAfterMs + 1);
  assert.deepEqual([(await getRun(db, busy))!.status, (await getRun(db, busy))!.error_ref], ["failed", "timeout"]);
});

test("agent text and links are cleaned before they are stored", () => {
  assert.equal(cleanEventText("  Page 1:\n 12 links\u0007 "), "Page 1: 12 links");
  assert.equal(cleanEventText("x".repeat(500))!.length, 200);
  assert.equal(cleanEventText(""), null);
  assert.equal(cleanEventText(42), null);
  assert.equal(cleanEventText("<script>alert(1)</script>"), "<script>alert(1)</script>", "kept as text; React escapes it on the page");
  const repo = "zenspiro/Cambridge";
  assert.equal(cleanRunUrl("https://github.com/zenspiro/Cambridge/actions/runs/41316201795", repo), "https://github.com/zenspiro/Cambridge/actions/runs/41316201795");
  for (const bad of ["https://github.com/other/repo/actions/runs/1", "https://evil.example/zenspiro/Cambridge/actions/runs/1",
    "javascript:alert(1)", "https://github.com/zenspiro/Cambridge/actions/runs/1?x=y", "https://github.com/zenspiroXCambridge/actions/runs/1", 7]) {
    assert.equal(cleanRunUrl(bad, repo), null, String(bad));
  }
  assert.equal(cleanRunUrl("https://github.com/zenspiro/Cambridge/actions/runs/1", undefined), null);
});
