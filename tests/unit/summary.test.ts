import { test } from "node:test";
import assert from "node:assert/strict";
import { countTypes, groupFiles, pageTitle, summariseFiles } from "../../src/lib/library/summary.ts";
import { cleanEvent } from "../../src/lib/agent/runs.ts";
import { reasonText } from "../../src/lib/agent/labels.ts";
import { versionForFile } from "../../src/lib/library/papers.ts";

test("files are summarised by session in plain words", () => {
  const june = ["11", "21", "31", "41", "51", "61"].flatMap((p) => [`0625_s24_qp_${p}.pdf`, `0625_s24_ms_${p}.pdf`]);
  const names = [...june, "0625_s24_ci_51.pdf", "0625_s24_er.pdf", "0625_y23_sp_1.pdf", "0625_y23_sy.pdf", "0625_w23_qp_42.pdf", "junk.pdf"];
  assert.deepEqual(groupFiles(names).map((g) => g.label), ["June 2024", "November 2023", "Syllabus 2023 version"]);
  assert.equal(
    summariseFiles(names),
    "June 2024: 6 question papers, 6 mark schemes, 1 confidential instructions, examiner report; November 2023: 1 question paper; Syllabus 2023 version: 1 specimen paper, syllabus",
  );
  assert.equal(summariseFiles([]), "");
  const many = [2022, 2023, 2024, 2025, 2026].map((y) => `0625_s${y % 100}_qp_12.pdf`);
  assert.ok(summariseFiles(many, 2).endsWith("and 3 more"));
  assert.equal(countTypes(groupFiles(["0625_s24_gt.pdf"])[0]!.files), "grade thresholds");
});

test("page titles are read and tidied", () => {
  assert.equal(pageTitle("<html><head><title>\n Cambridge IGCSE Physics (0625) &amp; past papers </title>"), "Cambridge IGCSE Physics (0625) & past papers");
  assert.equal(pageTitle("<p>no title</p>"), null);
  assert.equal(pageTitle(`<title>${"x".repeat(300)}</title>`)!.length, 120);
});

test("agent events: text, or a checked file with outcome, reason and size", () => {
  assert.deepEqual(cleanEvent("  Read page\n one "), { text: "Read page one" });
  assert.deepEqual(cleanEvent({ text: "1 of 2: stored", file: "0625_S24_QP_12.pdf", outcome: "stored", bytes: 1200 }), {
    text: "1 of 2: stored", file: "0625_s24_qp_12.pdf", outcome: "stored", bytes: 1200,
  });
  assert.deepEqual(cleanEvent({ text: "x", file: "../etc/passwd", outcome: "deleted", reason: "<b>", bytes: -1 }), { text: "x" }, "bad parts are dropped");
  assert.equal(cleanEvent({ file: "0625_s24_qp_12.pdf" }), null, "text is required");
  assert.equal(cleanEvent(7), null);
});

test("reasons and versions read in words", () => {
  assert.equal(reasonText("not_pdf"), "Not a PDF");
  assert.equal(reasonText("http_404"), "the website answered 404");
  assert.equal(reasonText("download_failed"), "the download did not finish");
  assert.equal(reasonText(undefined), "");
  const v = [{ id: "a", valid_from_year: 2023, valid_to_year: 2025 }, { id: "b", valid_from_year: 2026, valid_to_year: 2028 }];
  assert.equal(versionForFile(v, "0625_s24_qp_12.pdf"), "a");
  assert.equal(versionForFile(v, "0625_y26_sp_1.pdf"), "b");
  assert.equal(versionForFile(v, "0625_y24_sp_1.pdf"), null, "specimens go by the version's start year");
  assert.equal(versionForFile(v, "nope"), null);
});
