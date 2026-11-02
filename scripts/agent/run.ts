// The download agent (brief 3.8, 8.1). Runs in GitHub Actions: node scripts/agent/run.ts
// Reads its run from the Worker, visits only approved start pages, obeys robots.txt,
// waits between requests, never logs in, and hands each PDF to the Worker to store.
// Needs: APP_URL, AGENT_SECRET, JOB_ID. Uses only Node built-ins and shared src/lib files.
import { signRequest } from "../../src/lib/agent/sign.ts";
import { extractPdfLinks, toCambridgeName } from "../../src/lib/agent/links.ts";
import { parseRobots } from "../../src/lib/agent/robots.ts";
import { parseCambridgeName } from "../../src/lib/library/names.ts";
import { REASON_LABELS } from "../../src/lib/library/labels.ts";
import { pageTitle, summariseFiles } from "../../src/lib/library/summary.ts";
import { SESSION_LABELS } from "../../src/lib/config.ts";

type Job = {
  params: { code: string; years: number[]; sessions: string[]; mode: "dry" | "download" };
  sources: { siteId: string; name: string; baseUrl: string; pages: string[] }[];
  have: string[];
  limits: { maxFiles: number; maxFileBytes: number; delayMs: number; userAgentToken: string };
};

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.AGENT_SECRET ?? "";
const JOB_ID = process.env.JOB_ID ?? "";
// Local tests only: allows http sources on this machine and a shorter wait.
const TEST_MODE = process.env.AGENT_TEST_MODE === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL);
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

if (!/^https?:\/\/[^/]+$/.test(APP_URL) || !/^[A-Za-z0-9_-]{10,64}$/.test(JOB_ID) || SECRET.length < 32) {
  console.error("agent: APP_URL, JOB_ID and AGENT_SECRET (32+ characters) are required");
  process.exit(2);
}

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string) => console.log(`[agent] ${msg}`);

/** Signed call to the Worker. */
async function api(path: string, body: Uint8Array, extra: Record<string, string> = {}, contentType = "application/json") {
  const headers = { ...(await signRequest(SECRET, "POST", path, body)), ...extra, "Content-Type": contentType };
  const res = await fetch(APP_URL + path, { method: "POST", headers, body: body as BodyInit });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // keep null
  }
  return { status: res.status, data };
}

// One polite fetcher per website: waits between requests, identifies itself,
// follows redirects only within the same website.
const lastHit = new Map<string, number>();
let delayMs = 5_000;
let userAgent = "ExamPrepLibraryAgent/1.0";

async function politeFetch(url: string, maxBytes: number): Promise<{ status: number; bytes: Uint8Array; type: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    const wait = (lastHit.get(current.origin) ?? 0) + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(current.origin, Date.now());
    const res = await fetch(current, { redirect: "manual", headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(60_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, current);
      if (next.origin !== current.origin) return { status: 310, bytes: new Uint8Array(), type: "" }; // left the site: refuse
      current = next;
      continue;
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return { status: 413, bytes: new Uint8Array(), type: "" };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        return { status: 413, bytes: new Uint8Array(), type: "" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    return { status: res.status, bytes, type: res.headers.get("content-type") ?? "" };
  }
  return { status: 310, bytes: new Uint8Array(), type: "" };
}

type Report = {
  pagesVisited: number;
  linksFound: number;
  candidates: { name: string; url: string; siteId: string }[];
  stored: string[];
  skippedHave: number;
  skippedNotRequested: number;
  failed: { name: string; reason: string }[];
  unmatched: string[];
  robotsBlocked: string[];
  pageErrors: { url: string; status: string }[];
  error?: string;
};

// Link to this run's own log on GitHub (set by GitHub Actions; absent locally).
const RUN_URL =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

class Cancelled extends Error {}

/**
 * Live update for the run page. A 409 means the admin cancelled the run (or it was
 * closed): stop at once. Other failures only skip this update; the run goes on.
 */
type Event = string | { text: string; file?: string; outcome?: "stored" | "failed" | "found"; reason?: string; bytes?: number };

async function progress(pct: number, step: string, event?: Event) {
  log(typeof event === "string" ? event : event?.text ?? step);
  try {
    const r = await api("/api/agent/progress", enc.encode(JSON.stringify({ jobId: JOB_ID, progress: pct, step, event, runUrl: RUN_URL })));
    if (r.status === 409) throw new Cancelled("the run was cancelled or closed in the admin panel");
  } catch (e) {
    if (e instanceof Cancelled) throw e;
  }
}

const report: Report = {
  pagesVisited: 0, linksFound: 0, candidates: [], stored: [], skippedHave: 0, skippedNotRequested: 0,
  failed: [], unmatched: [], robotsBlocked: [], pageErrors: [],
};

async function finish(ok: boolean) {
  const trim = <T>(a: T[], n: number) => a.slice(0, n);
  const body = {
    jobId: JOB_ID,
    ok,
    report: {
      ...report,
      candidates: trim(report.candidates, 1000).map(({ name, url }) => ({ name, url })),
      stored: trim(report.stored, 1000),
      failed: trim(report.failed, 500),
      unmatched: trim(report.unmatched, 300),
      robotsBlocked: trim(report.robotsBlocked, 300),
      pageErrors: trim(report.pageErrors, 100),
    },
  };
  const r = await api("/api/agent/finish", enc.encode(JSON.stringify(body)));
  log(`finish: ${r.status}`);
}

async function main() {
  const start = await api("/api/agent/job", enc.encode(JSON.stringify({ jobId: JOB_ID })));
  if (start.status !== 200) throw new Error(`could not load the run (${start.status})`);
  const job = start.data as Job;
  delayMs = TEST_MODE ? Number(process.env.AGENT_DELAY_MS ?? 200) : Math.max(job.limits.delayMs, 5_000);
  userAgent = `${job.limits.userAgentToken}/1.0 (+${APP_URL})`;
  const years = new Set(job.params.years);
  const sessions = new Set(job.params.sessions);
  const have = new Set(job.have);
  const seen = new Set<string>();
  const totalPages = job.sources.reduce((n, s) => n + s.pages.length, 0);
  const findShare = job.params.mode === "dry" ? 95 : 20; // share of the bar for reading pages
  let pagesDone = 0;
  const sessionWords = job.params.sessions.map((s) => SESSION_LABELS[s] ?? s).join(", ");
  await progress(1, "Starting",
    `Started a ${job.params.mode === "dry" ? "dry run (nothing is downloaded)" : "download of missing files"} for ${job.params.years.join(", ")}, ${sessionWords}. ` +
    `${job.sources.length} source${job.sources.length === 1 ? "" : "s"} with ${totalPages} start page${totalPages === 1 ? "" : "s"}; ${have.size} files already in the library.`);

  const allowedBySite = new Map<string, (path: string) => boolean>();
  for (const site of job.sources) {
    const base = new URL(site.baseUrl);
    if (base.protocol !== "https:" && !TEST_MODE) {
      report.pageErrors.push({ url: site.baseUrl, status: "not https" });
      continue;
    }
    // robots.txt: missing (4xx) means everything is allowed; unreachable (5xx, errors) means nothing is.
    let allowed: (path: string) => boolean = () => false;
    await progress(2, `Reading ${base.host}/robots.txt`);
    try {
      const r = await politeFetch(`${base.origin}/robots.txt`, 512 * 1024);
      if (r.status >= 200 && r.status < 300) allowed = parseRobots(new TextDecoder().decode(r.bytes), job.limits.userAgentToken);
      else if (r.status >= 400 && r.status < 500) allowed = () => true;
      else report.pageErrors.push({ url: `${base.origin}/robots.txt`, status: String(r.status) });
    } catch {
      report.pageErrors.push({ url: `${base.origin}/robots.txt`, status: "unreachable" });
    }
    const robotsOk = report.pageErrors.every((e) => !e.url.startsWith(`${base.origin}/robots.txt`));
    await progress(3, `Reading ${site.name}`, robotsOk
      ? `${site.name}: read its robots.txt (the site's rules for automated visitors) and will follow it`
      : `${site.name}: its robots.txt could not be read, so this source is skipped to be safe`);
    allowedBySite.set(site.siteId, allowed);

    for (const page of site.pages) {
      pagesDone++;
      const pct = 3 + Math.round(((pagesDone - 1) / Math.max(totalPages, 1)) * (findShare - 3));
      await progress(pct, `Reading start page ${pagesDone} of ${totalPages}`);
      if (!allowed(new URL(page).pathname)) {
        report.robotsBlocked.push(page);
        await progress(pct, `Reading start page ${pagesDone} of ${totalPages}`, `Start page ${pagesDone} skipped: the site's robots.txt does not allow it (${page})`);
        continue;
      }
      let html = "";
      try {
        const r = await politeFetch(page, MAX_PAGE_BYTES);
        if (r.status !== 200) {
          report.pageErrors.push({ url: page, status: String(r.status) });
          await progress(pct, `Reading start page ${pagesDone} of ${totalPages}`, `Start page ${pagesDone} could not be read: the website answered ${r.status} (${page})`);
          continue;
        }
        html = new TextDecoder().decode(r.bytes);
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        report.pageErrors.push({ url: page, status: "unreachable" });
        await progress(pct, `Reading start page ${pagesDone} of ${totalPages}`, `Start page ${pagesDone} could not be reached (${page})`);
        continue;
      }
      report.pagesVisited++;
      const links = extractPdfLinks(html, page, site.baseUrl);
      report.linksFound += links.length;
      const before = report.candidates.length;
      const haveBefore = report.skippedHave;
      const outsideBefore = report.skippedNotRequested;
      const unmatchedBefore = report.unmatched.length;
      const title = pageTitle(html) ?? page;
      for (const link of links) {
        if (seen.has(link)) continue;
        seen.add(link);
        const name = toCambridgeName(link, job.params.code);
        const p = name ? parseCambridgeName(name) : null;
        if (!name || !p) {
          report.unmatched.push(link);
          continue;
        }
        if (!years.has(p.year) || !sessions.has(p.session)) {
          report.skippedNotRequested++;
          continue;
        }
        if (have.has(name) || report.candidates.some((c) => c.name === name)) {
          report.skippedHave++;
          continue;
        }
        if (!allowed(new URL(link).pathname)) {
          report.robotsBlocked.push(link);
          continue;
        }
        report.candidates.push({ name, url: link, siteId: site.siteId });
      }
      const fresh = report.candidates.slice(before).map((c) => c.name);
      const parts = [
        fresh.length ? `${fresh.length} new: ${summariseFiles(fresh)}` : "nothing new for this run",
        report.skippedHave - haveBefore ? `${report.skippedHave - haveBefore} already in the library` : "",
        report.skippedNotRequested - outsideBefore ? `${report.skippedNotRequested - outsideBefore} for years or sessions not in this run` : "",
        report.unmatched.length - unmatchedBefore ? `${report.unmatched.length - unmatchedBefore} not recognised` : "",
      ].filter(Boolean);
      await progress(pct, `Reading start page ${pagesDone} of ${totalPages}`, `Read "${title}": ${links.length} PDF links. ${parts.join("; ")}.`);
    }
  }
  const found = report.candidates.map((c) => c.name);
  await progress(findShare, "Pages read", found.length
    ? `Found ${found.length} file${found.length === 1 ? "" : "s"} to ${job.params.mode === "dry" ? "list (not downloaded in a dry run)" : "download"}: ${summariseFiles(found, 6)}.`
    : `Nothing new to ${job.params.mode === "dry" ? "list" : "download"}: every matching file is already in the library (${report.skippedHave}).`);

  if (job.params.mode === "download") {
    const todo = report.candidates.slice(0, job.limits.maxFiles);
    let n = 0;
    for (const c of todo) {
      n++;
      const pct = findShare + Math.round(((n - 1) / Math.max(todo.length, 1)) * (99 - findShare));
      const step = `Downloading file ${n} of ${todo.length}`;
      await progress(pct, step);
      const failedBefore = report.failed.length;
      let lastBytes = 0;
      try {
        const r = await politeFetch(c.url, job.limits.maxFileBytes);
        if (r.status !== 200) {
          report.failed.push({ name: c.name, reason: `http_${r.status}` });
        } else {
          lastBytes = r.bytes.length;
          const res = await api("/api/agent/file", r.bytes, {
            "x-agent-job": JOB_ID, "x-agent-file": c.name, "x-agent-site": c.siteId, "x-agent-url": c.url,
          }, "application/pdf");
          const out = res.data as { ok?: boolean; reason?: string; error?: string } | null;
          if (res.status === 200 && out?.ok) report.stored.push(c.name);
          else report.failed.push({ name: c.name, reason: out?.reason ?? out?.error ?? `worker_${res.status}` });
          if (res.status === 429 || res.status === 409) break; // run limit reached or run closed
        }
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        report.failed.push({ name: c.name, reason: "download_failed" });
      }
      const failed = report.failed.length > failedBefore ? report.failed[report.failed.length - 1] : null;
      const why = failed
        ? (REASON_LABELS as Record<string, string>)[failed.reason] ?? (failed.reason.startsWith("http_") ? `the website answered ${failed.reason.slice(5)}` : failed.reason)
        : "";
      const bytes = lastBytes;
      await progress(pct, step, failed
        ? { text: `${n} of ${todo.length}: ${c.name} not stored (${why})`, file: c.name, outcome: "failed", reason: failed.reason }
        : { text: `${n} of ${todo.length}: ${c.name} stored`, file: c.name, outcome: "stored", bytes });
    }
    await progress(99, "Finishing", report.stored.length
      ? `Done: ${report.stored.length} stored (${summariseFiles(report.stored, 6)})${report.failed.length ? `; ${report.failed.length} not stored, see the list below` : ""}.`
      : `Done: nothing was stored${report.failed.length ? `; ${report.failed.length} not stored, see the list below` : ""}.`);
  }
}

try {
  await main();
  await finish(true);
} catch (err) {
  if (err instanceof Cancelled) {
    log("stopped: the run was cancelled in the admin panel");
    process.exit(0);
  }
  report.error = err instanceof Error ? err.message.slice(0, 300) : "unknown error";
  console.error(`[agent] ${report.error}`);
  try {
    await finish(false);
  } catch {
    // The Worker closes runs that never report back after 3 hours.
  }
  process.exit(1);
}
