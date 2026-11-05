import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { testBucket, testDb } from "./helpers/d1.ts";
import { examName, parseCambridgeName, storageKey } from "../../src/lib/library/names.ts";
import { expectedFiles, gapReport, parseRules, sessionDue } from "../../src/lib/library/expected.ts";
import { looksLikePdf, storeDocument } from "../../src/lib/library/store.ts";
import { addSite, normaliseSiteUrl, removeSite, setSiteEnabled } from "../../src/lib/library/sources.ts";
import { LIBRARY } from "../../src/lib/config.ts";
import { createJob, finishJob, getJob } from "../../src/lib/jobs.ts";
import { getLibrarySettings } from "../../src/lib/settings.ts";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}\n%%EOF`);

test("Cambridge names parse, and junk does not", () => {
  assert.deepEqual(parseCambridgeName("0625_s23_qp_42.pdf"), {
    fileName: "0625_s23_qp_42.pdf", code: "0625", session: "s", year: 2023, docType: "qp", paper: 4, variant: 2,
  });
  assert.equal(parseCambridgeName("0625_W24_MS_33.PDF")?.fileName, "0625_w24_ms_33.pdf");
  assert.deepEqual(parseCambridgeName("0625_m25_gt.pdf")?.docType, "gt");
  assert.equal(parseCambridgeName("0625_s22_er.pdf")?.paper, null);
  assert.equal(parseCambridgeName("0625_s22_ci_5.pdf")?.variant, null);
  assert.equal(parseCambridgeName("0625_y26_sp_2.pdf")?.session, "y");
  assert.equal(parseCambridgeName("0625_y26_sy.pdf")?.docType, "sy");
  for (const bad of ["", "0625_s23_qp_42.exe", "../0625_s23_qp_42.pdf", "0625_s23_qp_42.pdf.exe", "0625_x23_qp_42.pdf",
    "0625_s23_qp_04.pdf", "0625/s23_qp_42.pdf", "a".repeat(41)]) {
    assert.equal(parseCambridgeName(bad), null, bad);
  }
  const p = parseCambridgeName("0625_s23_qp_42.pdf")!;
  assert.equal(storageKey(p), "0625/2023/s/0625_s23_qp_42.pdf");
  assert.equal(examName("0625", "m", 2026, "ms", 2, 2), "0625_m26_ms_22.pdf");
});

test("expected files and the gap report follow the syllabus rules", () => {
  const rules = parseRules('{"papers":[1,2,3,4,5,6],"variants":{"m":[2],"s":[1,2,3],"w":[1,2,3]},"perPaper":["qp","ms"],"ciPapers":[5],"perSession":["er","gt"]}')!;
  const march = expectedFiles("0625", rules, 2024, "m");
  assert.equal(march.length, 6 * 2 + 1 + 2); // qp+ms per paper, ci for paper 5, er+gt
  assert.ok(march.includes("0625_m24_ci_52.pdf") && march.includes("0625_m24_er.pdf"));
  assert.equal(expectedFiles("0625", rules, 2024, "s").length, 3 * 13 + 2);
  assert.equal(parseRules("not json"), null);

  const last = { year: 2026, session: "s" as const };
  assert.equal(sessionDue(2026, "w", last), false);
  assert.equal(sessionDue(2026, "s", last), true);
  assert.equal(sessionDue(2025, "w", last), true);

  const have = new Set(["0625_m26_qp_22.pdf"]);
  const cells = gapReport("0625", () => rules, have, { fromYear: 2025, toYear: 2026, last });
  assert.deepEqual(cells.map((c) => `${c.year}${c.session}`), ["2026m", "2026s", "2025m", "2025s", "2025w"]);
  assert.equal(cells[0]!.have, 1);
  assert.ok(!cells[0]!.missing.includes("0625_m26_qp_22.pdf"));
});

test("PDF check looks at the header", () => {
  assert.equal(looksLikePdf(pdf()), true);
  assert.equal(looksLikePdf(new TextEncoder().encode("<html>%PDF-")), true); // allowed within 1024 bytes
  assert.equal(looksLikePdf(new TextEncoder().encode("MZ executable")), false);
  assert.equal(looksLikePdf(new Uint8Array()), false);
});

test("store: good file is reserved, written, marked stored and audited", async () => {
  const db = testDb();
  const bucket = testBucket();
  const r = await storeDocument(db, bucket, { fileName: "0625_s23_qp_42.pdf", bytes: pdf("a"), actorId: "platform-admin", origin: "upload" });
  assert.ok(r.ok);
  assert.ok(bucket.objects.has("0625/2023/s/0625_s23_qp_42.pdf"));
  const row = db.raw.prepare("SELECT status, syllabus_id, paper, variant FROM source_document").get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: "stored", syllabus_id: "0625-2023", paper: 4, variant: 2 });
  const a = db.raw.prepare("SELECT action, entity FROM audit_log").all() as Record<string, unknown>[];
  assert.deepEqual(a.map((x) => x.action), ["source.upload"]);
});

test("store: picks the syllabus version by year", async () => {
  const db = testDb();
  for (const [name, syl] of [["0625_w22_ms_11.pdf", "0625-2020"], ["0625_m26_qp_22.pdf", "0625-2026"]] as const) {
    assert.ok((await storeDocument(db, testBucket(), { fileName: name, bytes: pdf(name), actorId: "a", origin: "upload" })).ok);
    const row = db.raw.prepare("SELECT syllabus_id FROM source_document WHERE file_name = ?").get(name) as { syllabus_id: string };
    assert.equal(row.syllabus_id, syl);
  }
});

test("store: rejects bad names, years, sizes, non-PDFs and unknown syllabi", async () => {
  const db = testDb();
  const b = testBucket();
  const go = (fileName: string, bytes = pdf()) => storeDocument(db, b, { fileName, bytes, actorId: "a", origin: "upload" });
  assert.deepEqual(await go("notes.pdf"), { fileName: "notes.pdf", ok: false, reason: "name" });
  assert.equal(((await go("0625_s21_qp_42.pdf")) as { reason: string }).reason, "year");
  assert.equal(((await go("0625_s23_qp_42.pdf", new Uint8Array())) as { reason: string }).reason, "size");
  assert.equal(((await go("0625_s23_qp_42.pdf", new Uint8Array(LIBRARY.maxFileBytes + 1))) as { reason: string }).reason, "size");
  assert.equal(((await go("0625_s23_qp_42.pdf", new TextEncoder().encode("<script>"))) as { reason: string }).reason, "not_pdf");
  assert.equal(((await go("0999_s23_qp_42.pdf")) as { reason: string }).reason, "no_syllabus");
  assert.equal(b.objects.size, 0);
  assert.equal((db.raw.prepare("SELECT COUNT(*) n FROM source_document").get() as { n: number }).n, 0);
});

test("store: duplicates by name or by content are skipped without touching storage", async () => {
  const db = testDb();
  const b = testBucket();
  const go = (fileName: string, bytes: Uint8Array) => storeDocument(db, b, { fileName, bytes, actorId: "a", origin: "upload" });
  assert.ok((await go("0625_s23_qp_42.pdf", pdf("one"))).ok);
  const before = b.objects.get("0625/2023/s/0625_s23_qp_42.pdf");
  assert.equal(((await go("0625_s23_qp_42.pdf", pdf("two"))) as { reason: string }).reason, "same_name");
  assert.equal(b.objects.get("0625/2023/s/0625_s23_qp_42.pdf"), before, "the stored file was not overwritten");
  assert.equal(((await go("0625_s23_qp_43.pdf", pdf("one"))) as { reason: string }).reason, "same_content");
});

test("store: parallel uploads of the same file store it once", async () => {
  const db = testDb();
  const b = testBucket();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => storeDocument(db, b, { fileName: "0625_s24_qp_11.pdf", bytes: pdf("x"), actorId: "a", origin: "upload" })),
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test("store: a storage failure leaves no row behind", async () => {
  const db = testDb();
  await assert.rejects(storeDocument(db, testBucket({ failPut: true }), { fileName: "0625_s23_qp_42.pdf", bytes: pdf(), actorId: "a", origin: "upload" }));
  assert.equal((db.raw.prepare("SELECT COUNT(*) n FROM source_document").get() as { n: number }).n, 0);
  assert.ok((await storeDocument(db, testBucket(), { fileName: "0625_s23_qp_42.pdf", bytes: pdf(), actorId: "a", origin: "upload" })).ok, "can retry");
});

test("source site addresses: public https only, normal form", () => {
  assert.equal(normaliseSiteUrl("https://www.cambridgeinternational.org/programmes"), "https://www.cambridgeinternational.org/programmes/");
  assert.equal(normaliseSiteUrl("https://Example.ORG"), "https://example.org/");
  for (const bad of ["http://example.org/", "https://user:pw@example.org/", "https://127.0.0.1/", "https://localhost/",
    "https://[::1]/", "https://example.org:8443/", "javascript:alert(1)", "ftp://example.org/", "https://intranet/",
    "https://x.internal/", 42, "https://example.org/" + "a".repeat(300)]) {
    assert.equal(normaliseSiteUrl(bad), null, String(bad));
  }
});

test("source sites: add, duplicate, switch, remove, all audited", async () => {
  const db = testDb();
  assert.deepEqual(await addSite(db, { name: "", url: "https://a.org", notes: "" }, "a"), { ok: false, error: "name" });
  assert.deepEqual(await addSite(db, { name: "A", url: "http://a.org", notes: "" }, "a"), { ok: false, error: "url" });
  assert.deepEqual(await addSite(db, { name: "A", url: "https://a.org", notes: "x".repeat(301) }, "a"), { ok: false, error: "notes" });
  const r = await addSite(db, { name: "  Site\nA ", url: "https://a.org", notes: "" }, "a");
  assert.ok(r.ok);
  assert.deepEqual(await addSite(db, { name: "Again", url: "https://A.org/", notes: "" }, "a"), { ok: false, error: "exists" });
  assert.equal((db.raw.prepare("SELECT name FROM source_site WHERE base_url = 'https://a.org/'").get() as { name: string }).name, "Site A");
  if (!r.ok) return;
  assert.equal(await setSiteEnabled(db, r.id, false, "a"), true);
  assert.equal(await setSiteEnabled(db, "nope-nope", false, "a"), false);
  assert.equal(await removeSite(db, r.id, "a"), true);
  const actions = (db.raw.prepare("SELECT action FROM audit_log ORDER BY at, rowid").all() as { action: string }[]).map((x) => x.action);
  assert.deepEqual(actions, ["source_site.add", "source_site.disable", "source_site.remove"]);
});

test("the official Cambridge site is seeded and switched on", () => {
  const db = testDb();
  const s = db.raw.prepare("SELECT base_url, enabled FROM source_site WHERE kind = 'web'").all() as { base_url: string; enabled: number }[];
  assert.deepEqual(s.map((x) => ({ ...x })), [{ base_url: "https://www.cambridgeinternational.org/", enabled: 1 }]);
});

test("jobs record results and are found only by their own type", async () => {
  const db = testDb();
  const id = await createJob(db, "source_upload", "a", { files: 1 });
  await finishJob(db, id, "succeeded", { files: [] });
  assert.equal((await getJob(db, id, "source_upload"))?.status, "succeeded");
  assert.equal(await getJob(db, id, "other"), null);
  assert.equal(await getJob(db, "' OR 1=1 --", "source_upload"), null);
});

test("only admin code can reach the source bucket (brief 3.1)", () => {
  const src = new URL("../../src/", import.meta.url).pathname;
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const users = walk(src).filter((f) => /\.SOURCE\b/.test(readFileSync(f, "utf8"))).map((f) => relative(src, f));
  assert.ok(users.length > 0);
  for (const f of users) {
    const allowed = f.startsWith("app/admin/") || f === "app/health/route.ts" || f === "app/api/agent/file/route.ts" || f === "app/api/agent/doc/route.ts";
    assert.ok(allowed, `${f} touches env.SOURCE outside the admin area`);
  }
});

test("the Revisiontown Drive collection is seeded: one Drive source, 16 folders", () => {
  const db = testDb();
  const site = db.raw.prepare("SELECT kind, base_url, enabled FROM source_site WHERE id = 'revisiontown-drive'").get() as Record<string, unknown>;
  assert.deepEqual({ ...site }, { kind: "gdrive", base_url: "https://drive.google.com/", enabled: 1 });
  const folders = db.raw.prepare("SELECT folder_id FROM source_drive_folder WHERE site_id = 'revisiontown-drive'").all() as { folder_id: string }[];
  assert.equal(folders.length, 16);
  assert.ok(folders.every((f) => /^[A-Za-z0-9_-]{25,40}$/.test(f.folder_id)));
  const labels = db.raw.prepare("SELECT folder_id, label FROM source_drive_folder WHERE site_id = 'revisiontown-drive'").all() as { folder_id: string; label: string }[];
  assert.ok(labels.every((l) => /^IGCSE .+ \(\d{4}\)$/.test(l.label)), "every folder has a human name");
  assert.equal(labels.find((l) => l.folder_id === "1Ji-VoRovspqnZtvxhJW1CCdeMilxQBCX")?.label, "IGCSE Chemistry (0620)");
  assert.equal(labels.find((l) => l.folder_id === "1Baa4OKIzjjtHzwcy1-xwjBuCDMLh2FlW")?.label, "IGCSE Physics (0625)");
});

test("every Revisiontown subject is in the library, ready for a run", async () => {
  const db = testDb();
  const raw = db.raw;
  const folderCodes = (raw.prepare("SELECT label FROM source_drive_folder WHERE site_id = 'revisiontown-drive'").all() as { label: string }[])
    .map((l) => /\((\d{4})\)$/.exec(l.label)![1]!);
  const lib = await getLibrarySettings(db);
  for (const code of folderCodes) {
    const versions = raw.prepare("SELECT id, valid_from_year, valid_to_year, expected, essential_variants FROM syllabus WHERE code = ? ORDER BY valid_from_year")
      .all(code) as { id: string; valid_from_year: number; valid_to_year: number; expected: string; essential_variants: string }[];
    // Every library year has exactly one version, and each version has papers, routes and checklist rules.
    for (let y = lib.fromYear; y <= lib.toYear; y++) {
      assert.equal(versions.filter((v) => v.valid_from_year <= y && v.valid_to_year >= y).length, 1, `${code}: one version for ${y}`);
    }
    for (const v of versions) {
      const rules = parseRules(v.expected);
      assert.ok(rules && rules.papers.length > 0, `${v.id}: checklist rules`);
      const papers = raw.prepare("SELECT paper, school_assessed FROM syllabus_paper WHERE syllabus_id = ?").all(v.id) as { paper: number; school_assessed: number }[];
      assert.ok(papers.length > 0, `${v.id}: papers`);
      // The checklist asks only for papers that have a question paper (not coursework or speaking).
      for (const p of rules!.papers) assert.equal(papers.find((x) => x.paper === p)?.school_assessed, 0, `${v.id}: paper ${p} is an exam paper`);
      assert.ok((raw.prepare("SELECT COUNT(*) AS n FROM syllabus_route WHERE syllabus_id = ?").get(v.id) as { n: number }).n > 0, `${v.id}: routes`);
      assert.equal(v.essential_variants, '{"m":[2],"s":[2],"w":[2]}', `${v.id}: variant 2 essential`);
    }
    const pages = raw.prepare("SELECT url FROM source_page WHERE syllabus_code = ?").all(code) as { url: string }[];
    assert.ok(pages.length >= 2 && pages.every((p) => p.url.startsWith("https://www.cambridgeinternational.org/")), `${code}: Cambridge start pages`);
  }
  assert.equal(new Set(folderCodes).size, 16);
});
