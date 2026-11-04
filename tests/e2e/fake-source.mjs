// A fake source website for the agent test: robots.txt, one start page, a few PDFs.
import { createServer } from "node:http";

export function startFakeSource(port = 9911) {
  const pdf = (tag) => `%PDF-1.4\n% fake ${tag} ${Date.now()} ${Math.random()}\n%%EOF`;
  const files = {
    "/Images/111-june-2024-question-paper-11.pdf": pdf("qp11"),
    "/Images/112-june-2024-mark-scheme-paper-11.pdf": pdf("ms11"),
    "/Images/113-june-2024-examiner-report.pdf": pdf("er"),
    "/Images/114-2023-specimen-paper-1.pdf": pdf("sp1"),
    "/Images/115-june-2024-question-paper-21.pdf": "<html>not really a pdf</html>",
    "/Images/116-june-2019-question-paper-11.pdf": pdf("old"),
    "/Images/117-2023-2025-teacher-guide.pdf": pdf("guide"),
    "/blocked/118-june-2024-question-paper-31.pdf": pdf("blocked"),
  };
  const page = `<html><head><title>Physics 0625 past papers (test site)</title></head><body>
    ${Object.keys(files).map((f) => `<a href="${f}">x</a>`).join("\n")}
    <a href="https://evil.example/june-2024-question-paper-41.pdf">off site</a>
    <a href="/Images/119-june-2024-mark-scheme-paper-21.pdf">404</a>
  </body></html>`;
  const hits = [];
  // A fake Google Drive API (v3): a shared Physics folder tree, and a private folder.
  const FOLDER = "application/vnd.google-apps.folder";
  const drive = {
    ROOTFOLDER01: { name: "IGCSE Physics (0625)", kids: [["Y2024FOLDER", "2024", FOLDER], ["Y2019FOLDER", "2019", FOLDER], ["SPECFOLDER1", "Specimen Papers 2023", FOLDER]] },
    // Outside the test run's years: the agent must not open it.
    Y2019FOLDER: { name: "2019", kids: [["DRVFILE0009", "Question Paper 42.pdf", "application/pdf"]] },
    Y2024FOLDER: { name: "2024", kids: [["MAYJUNEFLDR", "May June", FOLDER]] },
    MAYJUNEFLDR: { name: "May June", kids: [
      ["DRVFILE0001", "Question Paper 12.pdf", "application/pdf"],
      ["DRVFILE0002", "Mark Scheme Paper 1 Variant 2.pdf", "application/pdf"],
      ["DRVFILE0003", "Examiner Report.pdf", "application/pdf"],
      ["DRVFILE0004", "Revision notes.pdf", "application/pdf"],
      ["DRVFILE0005", "0620_s24_qp_12.pdf", "application/pdf"],
      ["DRVFILE0006", "Teacher notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      // Google refuses this one, as it does for busy shared files.
      ["DRVBUSY0008", "Grade Thresholds.pdf", "application/pdf"],
    ] },
    SPECFOLDER1: { name: "Specimen Papers 2023", kids: [["DRVFILE0007", "Specimen Paper 2.pdf", "application/pdf"]] },
  };
  const driveFiles = { DRVFILE0001: pdf("d1"), DRVFILE0002: pdf("d2"), DRVFILE0003: pdf("d3"), DRVFILE0004: pdf("d4"), DRVFILE0007: pdf("d7") };
  const driveHits = [];
  function driveApi(req, res) {
    const u = new URL(req.url, "http://x");
    driveHits.push({ path: req.url, key: req.headers["x-goog-api-key"] });
    const send = (status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
    if (req.headers["x-goog-api-key"] !== "test-drive-key") return send(400, { error: { errors: [{ reason: "keyInvalid" }] } });
    const m = /^\/drive\/v3\/files(?:\/([A-Za-z0-9_-]+))?$/.exec(u.pathname);
    if (!m) return send(404, { error: { errors: [{ reason: "notFound" }] } });
    if (m[1] === "PRIVATEFOLDR") return send(403, { error: { errors: [{ reason: "forbidden" }] } });
    if (m[1] === "DRVBUSY0008" && u.searchParams.get("alt") === "media") return send(403, { error: { errors: [{ reason: "downloadQuotaExceeded" }] } });
    if (m[1] && u.searchParams.get("alt") === "media") {
      if (!driveFiles[m[1]]) return send(404, { error: { errors: [{ reason: "notFound" }] } });
      res.setHeader("Content-Type", "application/pdf");
      return res.end(driveFiles[m[1]]);
    }
    if (m[1]) return drive[m[1]] ? send(200, { id: m[1], name: drive[m[1]].name, mimeType: FOLDER }) : send(404, { error: { errors: [{ reason: "notFound" }] } });
    const parent = /'([A-Za-z0-9_-]+)' in parents/.exec(u.searchParams.get("q") ?? "")?.[1];
    if (parent === "PRIVATEFOLDR") return send(403, { error: { errors: [{ reason: "forbidden" }] } });
    const kids = drive[parent]?.kids ?? [];
    return send(200, { files: kids.map(([id, name, mimeType]) => ({ id, name, mimeType })) });
  }
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/drive/v3/")) return driveApi(req, res);
    hits.push({ path: req.url, ua: req.headers["user-agent"] });
    if (req.url === "/robots.txt") return res.end("User-agent: *\nDisallow: /blocked/\n");
    if (req.url === "/papers/0625/") return res.end(page);
    if (files[req.url]) {
      res.setHeader("Content-Type", "application/pdf");
      return res.end(files[req.url]);
    }
    res.statusCode = 404;
    res.end("nope");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, hits, driveHits, base: `http://127.0.0.1:${port}/` })));
}
