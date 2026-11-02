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
  const server = createServer((req, res) => {
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
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, hits, base: `http://127.0.0.1:${port}/` })));
}
