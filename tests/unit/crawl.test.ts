// Finding a subject on a website with no start page for it (owner, 11 Nov 2026). The pages below are made up in
// the shape of pastpapers.papacambridge.com's (a <base href>, files inside download links, viewer pages).
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkKind, onSite, pageLinks, pdfOf } from "../../src/lib/agent/crawl.ts";
import { toCambridgeName } from "../../src/lib/agent/links.ts";

const SITE = "https://pastpapers.example.com/";
const scope = { code: "0610", years: [2023, 2024, 2025, 2026], qualification: "IGCSE" };

test("links honour the page's <base href>, and files inside download links are found", () => {
  const html = `<base href="../../"><a href="papers/caie/igcse-biology-0610">Biology</a>
    <a href="download_file.php?files=https://pastpapers.example.com/directories/upload/0610_w25_qp_42.pdf">QP</a>
    <a href="#top">top</a><a href="mailto:x@y.z">mail</a><a href='/a/b.pdf'>b</a>`;
  const links = pageLinks(html, "https://pastpapers.example.com/papers/caie/igcse");
  assert.ok(links.includes("https://pastpapers.example.com/papers/caie/igcse-biology-0610"), "resolved against the base, not the page");
  const files = links.map(pdfOf).filter(Boolean);
  assert.deepEqual(files, ["https://pastpapers.example.com/directories/upload/0610_w25_qp_42.pdf", "https://pastpapers.example.com/a/b.pdf"]);
  assert.equal(toCambridgeName(files[0]!, "0610"), "0610_w25_qp_42.pdf");
  assert.equal(toCambridgeName(files[0]!, "0620"), null, "another subject's file is never taken");
  assert.equal(pdfOf("https://x.org/page?next=https://x.org/home"), null);
});

test("only the site's own pages are followed", () => {
  assert.ok(onSite("https://pastpapers.example.com/papers/x", SITE));
  assert.ok(!onSite("https://notes.example.com/papers/x", SITE));
  assert.ok(!onSite("https://pastpapers.example.com/other", "https://pastpapers.example.com/papers/"));
});

test("which links lead to the subject's files for the run's years", () => {
  const k = (path: string) => linkKind(SITE + path, scope);
  assert.equal(k("papers/caie/igcse"), "qualification");
  assert.equal(k("?board=1"), "other");
  assert.equal(k("papers/caie/igcse-biology-0610"), "subject");
  assert.equal(k("papers/caie/igcse-biology-0610-2025-oct-nov"), "session");
  assert.equal(k("papers/caie/igcse-biology-0610-2019-may-june"), "outside", "a year outside the run");
  assert.equal(k("papers/caie/igcse-chemistry-0620"), "outside", "another subject of the qualification");
  assert.equal(k("papers/caie/igcse-biology-20610"), "qualification", "0610 inside a longer number is not the code");
  assert.equal(k("viewer/caie/igcse-biology-0610-2026-may-june-0610-s26-qp-42-pdf"), "file", "a file's viewer page");
  assert.equal(k("viewer/caie/igcse-biology-0610-topical-2023-june-2023-enzymes-igcse-0610-biology-pdf"), "file");
  assert.equal(k("papers/caie/igcse-biology-0610-topical-past-papers"), "other", "topical pages are never followed");
  assert.equal(k("papers/caie/igcse-biology-0610-topic-wise-2024"), "other");
  assert.equal(k("papers/caie/igcse-biology-0610"), "subject");
});
