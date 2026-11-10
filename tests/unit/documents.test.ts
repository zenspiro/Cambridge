// The Documents table (owner, 10 Nov 2026): review status beside the AI's score, a filter on every column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docRow, filterDocs, readDocFilter, reviewSummary, sortDocs, type RawDoc } from "../../src/lib/library/documents.ts";

const subjects = [{ code: "0625", label: "IGCSE Physics (0625)" }, { code: "0580", label: "IGCSE Mathematics (0580)" }];
const papers = [{ syllabus_id: "0625-2023", paper: 4, name: "Theory", format: "structured" as const, tier: "extended" as const }];
const flag = (fp: string) => ({ key: `words:1(a)#${fp}`, item: "1(a)", kind: "words", colour: "red", reason: "x", pdfText: "", fingerprint: fp, v: 3 });
const raw = (over: Partial<RawDoc>): RawDoc => ({
  id: "d", syllabus_id: "0625-2023", session: "m", year: 2025, paper: 4, variant: 2, doc_type: "qp", file_name: "0625_m25_qp_42.pdf",
  items: 44, flags: "[]", dismissed: "[]", read_at: 1000, override_at: null, first_items: 44, first_clean: 43, first_red: 1, first_at: 1000,
  scores: JSON.stringify([{ at: 1000, items: 44, clean: 43, red: 1, claude: "claude-haiku-5-5", gemini: "gemini-3.6-flash" }]), ...over,
});
const owner = { doc_id: "d", actor: "platform-admin", at: 2000, name: "Owner" };

test("review status: a person's change after the last full reading is a review; automatic fixes and check runs are not", () => {
  const reviewed = docRow(raw({ read_at: 5000 }), subjects, papers, new Set(), owner, 2000);
  assert.equal(reviewed.status, "reviewed", "a check run later (read_at moved on) does not undo the review");
  assert.equal(reviewed.reviewerName, "Owner");
  assert.equal(reviewed.paperName, "4 Theory");
  assert.equal(reviewed.tier, "Extended");
  assert.equal(reviewed.score?.pct, 97);
  assert.match(reviewed.models, / with /, "both AIs of the first reading, for the score's hover");
  assert.equal(docRow(raw({}), subjects, papers, new Set(), undefined, null).status, "ready", "no flags, nobody looked");
  const open = raw({ flags: JSON.stringify([flag("aaaa1111"), flag("bbbb2222")]), dismissed: JSON.stringify(["aaaa1111"]) });
  const needs = docRow(open, subjects, papers, new Set(), owner, 2000);
  assert.equal(needs.status, "needs");
  assert.equal(needs.open, 1);
  assert.equal(docRow(open, subjects, papers, new Set(["bbbb2222"]), owner, 2000).status, "reviewed", "a subject rule counts as settled");
  assert.equal(docRow({ ...open, override_at: 3000 }, subjects, papers, new Set(), owner, 3000).status, "override");
  assert.equal(docRow(raw({ read_at: null, scores: null }), subjects, papers, new Set(), undefined, null).status, "unread");
  const er = docRow(raw({ doc_type: "er", paper: null, variant: null, read_at: null, file_name: "0625_m25_er.pdf" }), subjects, papers, new Set(), undefined, null);
  assert.equal(er.status, "unreadable");
  assert.equal(er.typeLabel.toLowerCase().includes("examiner"), true);
  assert.equal(docRow(raw({ scores: JSON.stringify([{ at: 9000, items: 44, clean: 44, red: 0, claude: "", gemini: "gemini-3.6-flash" }]) }), subjects, papers, new Set(), owner, 2000).status, "ready", "read again after the review: needs a look again");
});

test("filters: each column its own choice, the search across the row, the read dates; sorting and the summary", () => {
  const rows = [
    docRow(raw({ id: "a" }), subjects, papers, new Set(), owner, 2000),
    docRow(raw({ id: "b", doc_type: "ms", file_name: "0625_m25_ms_42.pdf", read_at: null, scores: null }), subjects, papers, new Set(), undefined, null),
    docRow(raw({ id: "c", syllabus_id: "0580-2025", year: 2024, session: "w", paper: 2, file_name: "0580_w24_qp_22.pdf", first_clean: 30, first_red: 0 }), subjects, papers, new Set(), undefined, null),
    docRow(raw({ id: "e", doc_type: "er", paper: null, variant: null, read_at: null, file_name: "0625_m25_er.pdf" }), subjects, papers, new Set(), undefined, null),
  ];
  const f = (q: Record<string, string[]>) => readDocFilter((k) => q[k] ?? []);
  assert.deepEqual(filterDocs(rows, f({ type: ["qp"] })).map((r) => r.id), ["a", "c"]);
  assert.deepEqual(filterDocs(rows, f({ subject: ["0580"] })).map((r) => r.id), ["c"]);
  assert.deepEqual(filterDocs(rows, f({ year: ["2025"], month: ["m"], status: ["reviewed", "unreadable"] })).map((r) => r.id), ["a", "e"]);
  assert.deepEqual(filterDocs(rows, f({ ai: ["none"] })).map((r) => r.id), ["b", "e"]);
  assert.deepEqual(filterDocs(rows, f({ by: ["platform-admin"] })).map((r) => r.id), ["a"]);
  assert.deepEqual(filterDocs(rows, f({ variant: ["none"] })).map((r) => r.id), ["e"]);
  assert.deepEqual(filterDocs(rows, f({ q: ["mathematics nov"] })).map((r) => r.id), ["c"]);
  assert.deepEqual(filterDocs(rows, f({ from: ["1970-01-01"], to: ["1970-01-01"] })).map((r) => r.id), ["a", "c"], "read dates: only read files");
  assert.deepEqual(f({ type: ["qp", "<script>"], sort: ["drop"], page: ["0"] }).type, ["qp"], "values are checked");
  // Weakest AI score first, files not read after them.
  assert.deepEqual(sortDocs(rows, "score", "asc").map((r) => r.id), ["c", "a", "e", "b"], "not read last, in the paper's own order");
  assert.deepEqual(sortDocs(rows, "year", "asc").map((r) => r.id), ["c", "e", "a", "b"], "oldest first, then the paper's own order");
  assert.deepEqual(sortDocs(rows, "year", "desc").map((r) => r.id), ["e", "a", "b", "c"]);
  assert.deepEqual(reviewSummary(rows), { read: 2, needs: 0, reviewed: 1, ready: 1, override: 0, unread: 1 });
});
