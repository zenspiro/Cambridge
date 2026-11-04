// The download agent (brief 3.8, 8.1). Runs in GitHub Actions: node scripts/agent/run.ts
// Reads its run from the Worker, visits only approved start pages, obeys robots.txt,
// waits between requests, never logs in, and hands each PDF to the Worker to store.
// Needs: APP_URL, AGENT_SECRET, JOB_ID. Uses only Node built-ins and shared src/lib files.
import { signRequest } from "../../src/lib/agent/sign.ts";
import { extractPdfLinks, toCambridgeName } from "../../src/lib/agent/links.ts";
import { parseRobots } from "../../src/lib/agent/robots.ts";
import { parseCambridgeName } from "../../src/lib/library/names.ts";
import { reasonText } from "../../src/lib/agent/labels.ts";
import { pageTitle, summariseFiles } from "../../src/lib/library/summary.ts";
import { SESSION_LABELS } from "../../src/lib/config.ts";
import { checkSummary, ruleSummary } from "../../src/lib/agent/runSummary.ts";
import { classifyFile, folderDecision, readFolder, type KnownSubject, type RunScope } from "../../src/lib/agent/classify.ts";
import { DriveError, driveRefusal, makeDrive, targetId, walk, type Drive } from "./drive.ts";
import { constants as zlibConstants, inflateSync } from "node:zlib";
import { firstPageText } from "../../src/lib/pdf/firstPage.ts";
import { readCover, type CoverReading } from "../../src/lib/library/cover.ts";

type Job = {
  params: { code: string; years: number[]; sessions: string[]; mode: "dry" | "download" | "check" };
  /** Library check: the subject's stored files. */
  storedDocs?: { id: string; fileName: string }[];
  sources: { siteId: string; name: string; baseUrl: string; pages: string[] }[];
  driveFolders?: { siteId: string; folderId: string; label: string }[];
  subjects?: KnownSubject[];
  have: string[];
  /** The owner's decisions on files that needed an eye (by Drive file id within a source). */
  decisions?: { siteId: string; id: string; decision: "accept" | "reject"; name: string | null }[];
  limits: {
    maxFiles: number; maxFileBytes: number; delayMs: number; userAgentToken: string;
    driveDelayMs?: number; driveMaxFolders?: number; driveMaxDepth?: number; coverReads?: number;
  };
};

// Google Drive API key (GitHub secret GOOGLE_DRIVE_API). Never logged or sent to our site.
const DRIVE_KEY = process.env.GOOGLE_DRIVE_API ?? "";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.AGENT_SECRET ?? "";
const JOB_ID = process.env.JOB_ID ?? "";
// Local tests only: allows http sources on this machine and a shorter wait.
const TEST_MODE = process.env.AGENT_TEST_MODE === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP_URL);
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
/** Folders or files per AI call (the Worker allows up to AGENT.aiBatch). */
const AI_BATCH = 40;

// The front page reader: text of page 1 (zlib from Node), then Cambridge's cover rules.
const inflate = async (d: Uint8Array) => new Uint8Array(inflateSync(d, { finishFlush: zlibConstants.Z_SYNC_FLUSH }));
async function coverOf(bytes: Uint8Array, codes: string[]): Promise<{ text: string; cover: CoverReading }> {
  const text = await firstPageText(bytes, inflate);
  return { text, cover: readCover(text, codes) };
}

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

/** A signed request whose answer is a file (library check). */
async function apiBytes(path: string, payload: Record<string, unknown>): Promise<{ status: number; bytes: Uint8Array }> {
  const body = enc.encode(JSON.stringify(payload));
  const headers = { ...(await signRequest(SECRET, "POST", path, body)), "Content-Type": "application/json" };
  const res = await fetch(APP_URL + path, { method: "POST", headers, body: body as BodyInit });
  return { status: res.status, bytes: res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array() };
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

type ReviewEntry = { where: string; why: string; driveId: string; siteId: string; suggest?: string; by: "ai" | "rules" };
const MAX_REVIEW = 200;

type Report = {
  pagesVisited: number;
  linksFound: number;
  candidates: { name: string; url: string; siteId: string; driveId?: string; why?: string }[];
  stored: string[];
  skippedHave: number;
  skippedNotRequested: number;
  failed: { name: string; reason: string }[];
  unmatched: string[];
  robotsBlocked: string[];
  pageErrors: { url: string; status: string }[];
  driveFolders?: DriveSummary[];
  /** Drive files nobody could place: for the owner to accept (as a checklist file) or reject. */
  review?: ReviewEntry[];
  /** Files skipped because the owner rejected them on an earlier run page. */
  rejected?: number;
  /** Front page reader: unclear files whose first page was read, and how many it named. */
  cover?: { read: number; named: number; aiNamed: number };
  /** Library check: stored files read, matching, unreadable, and those whose first page says otherwise. */
  check?: { read: number; matched: number; unreadable: number; items: { id: string; fileName: string; coverName: string | null; why: string }[] };
  /** Downloads whose first page gave another name: stored under that name, or held back. */
  renamed?: { from: string; to: string }[];
  heldBack?: number;
  /** Drive files the front page reader judged not original Cambridge files: later runs skip them. */
  autoRejected?: { siteId: string; driveId: string; where: string }[];
  /** Files the AI says are not original Cambridge files (notes, topic questions), with a few examples. */
  notNeeded?: { count: number; examples: string[] };
  /** Plain-English summary of the run (by the AI, or by rules when AI is not available). */
  summary?: string;
  summaryBy?: "ai" | "rules";
  ai?: { calls: number; note?: string };
  /** Set when Google Drive kept refusing downloads and the agent stopped asking. */
  drivePaused?: { reason: string; afterStored: number };
  /** Drive folders not read because they are for other subjects. */
  driveSkipped?: number;
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

// Workers AI through the signed /api/agent/ai endpoint. Any failure means "carry on with the
// rules": 503 (no AI) or 429 (this run's calls used up) switch it off for the rest of the run.
let aiOn = true;
let aiCalls = 0;
let aiFailures = 0;
let aiNote = "";
async function ai(task: "folders" | "names" | "cover" | "summary", payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!aiOn) return null;
  try {
    const r = await api("/api/agent/ai", enc.encode(JSON.stringify({ jobId: JOB_ID, task, ...payload })));
    if (r.status === 200 && r.data && typeof r.data === "object") {
      aiCalls++;
      return r.data as Record<string, unknown>;
    }
    if (r.status === 409) throw new Cancelled("the run was cancelled or closed in the admin panel");
    if (r.status === 502) aiFailures++;
    if (r.status === 503 || r.status === 429 || aiFailures >= 3) {
      aiOn = false;
      aiNote = r.status === 503 ? "AI was not available, so the agent used its rules only"
        : r.status === 429 ? "the AI call limit for one run was reached; the rest used rules only"
        : "the AI gave no usable answer three times, so the rest used rules only";
      log(aiNote);
    }
  } catch (e) {
    if (e instanceof Cancelled) throw e;
  }
  return null;
}

type DriveSummary = {
  folderId: string; name: string; looksLike: string; folders: number; pdfs: number; recognised: number;
  forThisSyllabus: number; otherSubjects: Record<string, number>; years: [number, number] | null; truncated: boolean; error?: string;
  /** Folders not opened (outside the run, or judged not useful), and the years the folder holds. */
  skippedFolders?: number; yearsHeld?: [number, number] | null; aiSkipped?: string[]; aiNamed?: number;
};

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
      candidates: trim(report.candidates, 1000).map(({ name, url, why }) => ({ name, url, ...(why ? { why } : {}) })),
      stored: trim(report.stored, 1000),
      failed: trim(report.failed, 500),
      unmatched: trim(report.unmatched, 300),
      review: trim(report.review ?? [], MAX_REVIEW),
      renamed: trim(report.renamed ?? [], 200),
      autoRejected: trim(report.autoRejected ?? [], 300),
      driveFolders: trim(report.driveFolders ?? [], 100),
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
  const decided = new Map((job.decisions ?? []).map((d) => [`${d.siteId}:${d.id}`, d]));
  const codes = (job.subjects ?? []).map((s) => s.code);
  if (!codes.includes(job.params.code)) codes.push(job.params.code);
  if (job.params.mode === "check") return checkLibrary(job, codes, years, sessions);
  /** Unclear Drive files a download run reads by their first page. */
  const unclear: ReviewEntry[] = [];
  const toReview = (e: Omit<ReviewEntry, "driveId" | "siteId"> & { driveId?: string; siteId?: string }) => {
    report.review ??= [];
    if (report.review.length < MAX_REVIEW && e.driveId && e.siteId) report.review.push(e as ReviewEntry);
    else if (report.unmatched.length < 300) report.unmatched.push(`${e.where}: ${e.why}`);
  };
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
  // Google Drive folders: walk each tree, work out what every PDF is, keep what this run asks for.
  let drive: Drive | null = null;
  const folders = job.driveFolders ?? [];
  if (folders.length > 0) {
    if (!DRIVE_KEY) {
      report.pageErrors.push({ url: "Google Drive", status: "the GOOGLE_DRIVE_API secret is missing in GitHub" });
      await progress(findShare, "Google Drive", "Google Drive folders skipped: the GOOGLE_DRIVE_API secret is missing in GitHub (Settings, Secrets and variables, Actions).");
    } else {
      const base = TEST_MODE && process.env.DRIVE_API_BASE ? process.env.DRIVE_API_BASE : "https://www.googleapis.com/drive/v3";
      drive = makeDrive({ key: DRIVE_KEY, base, delayMs: TEST_MODE ? 20 : Math.max(job.limits.driveDelayMs ?? 1000, 500) });
      report.driveFolders = [];
      // Only the folders for this run's subject are read. A folder whose name names another
      // subject ("IGCSE Chemistry (0620)") is skipped without a single call to Google.
      const subjects = job.subjects ?? [];
      const runSubject = subjects.find((s) => s.code === job.params.code);
      const runName = runSubject ? `${runSubject.qualification} ${runSubject.name} (${runSubject.code})` : job.params.code;
      const otherSubject = (name: string) => {
        const c = readFolder(name, subjects).code;
        return c !== null && c !== job.params.code;
      };
      const mine = folders.filter((f) => !f.label || !otherSubject(f.label));
      const skippedLabels = folders.filter((f) => !mine.includes(f)).map((f) => f.label);
      report.driveSkipped = skippedLabels.length;
      await progress(findShare, "Google Drive",
        mine.length === 0
          ? `None of the ${folders.length} Google Drive folders is for ${runName}, so none were read (${skippedLabels.length} are for other subjects).`
          : `Google Drive: reading ${mine.length === 1 ? "the folder" : `the ${mine.length} folders`} for ${runName}` +
            (skippedLabels.length ? `; skipped ${skippedLabels.length} for other subjects (${skippedLabels.slice(0, 5).join(", ")}${skippedLabels.length > 5 ? ` and ${skippedLabels.length - 5} more` : ""}).` : "."));
      let n = 0;
      for (const f of mine) {
        n++;
        const step = `Reading ${f.label || "a Google Drive folder"} (${n} of ${mine.length})`;
        await progress(findShare, step);
        try {
          if (!f.label) {
            // No name saved: ask Google for the folder's name first, and skip it if it is another subject's.
            const root = await drive.folder(f.folderId);
            if (otherSubject(root.name)) {
              report.driveSkipped++;
              await progress(findShare, step, `Skipped Google Drive folder "${root.name}": it is for another subject.`);
              continue;
            }
          }
          // Open only folders that can hold what this run wants: the rules decide when a name is
          // clear ("2019", "Feb March", "Chemistry (0620)"); the AI decides the unclear ones.
          const scope: RunScope = { code: job.params.code, years: job.params.years, sessions: job.params.sessions as RunScope["sessions"] };
          const heldYears: number[] = [];
          const aiSkipped: string[] = [];
          const choose = async (path: string[], names: string[]) => {
            const ds = names.map((nm) => folderDecision(nm, scope, subjects));
            names.forEach((nm) => { const y = readFolder(nm, subjects).year; if (y) heldYears.push(y); });
            // Below a folder already matched (a wanted year or session), unclear names are opened.
            const inside = path.slice(1).some((nm) => folderDecision(nm, scope, subjects).open === "yes");
            const ask = inside ? [] : ds.map((d, i) => (d.open === "unsure" ? i : -1)).filter((i) => i >= 0).slice(0, AI_BATCH);
            const answer = ask.length ? await ai("folders", { path, names: ask.map((i) => names[i]) }) : null;
            const verdicts = Array.isArray(answer?.folders) ? (answer.folders as { open: boolean; why: string }[]) : [];
            return ds.map((d, i) => {
              if (d.open !== "unsure") return d.open === "yes";
              const v = verdicts[ask.indexOf(i)];
              if (v && v.open === false) {
                aiSkipped.push(`${[...path.slice(1), names[i]].join(" / ")}: ${v.why || "not useful for this run"}`);
                return false;
              }
              return true;
            });
          };
          const tree = await walk(drive, f.folderId, { maxFolders: job.limits.driveMaxFolders ?? 2000, maxDepth: job.limits.driveMaxDepth ?? 8 },
            async (path, count) => { if (count % 25 === 0) await progress(findShare, `${step}: ${count} folders opened (${path.join(" / ")})`); },
            choose);
          const summary: DriveSummary = {
            folderId: f.folderId, name: tree.root, looksLike: "", folders: tree.folders, pdfs: tree.pdfs.length, recognised: 0,
            forThisSyllabus: 0, otherSubjects: {}, years: null, truncated: tree.truncated,
            skippedFolders: tree.skipped,
            yearsHeld: heldYears.length ? [Math.min(...heldYears), Math.max(...heldYears)] : null,
            aiSkipped: aiSkipped.slice(0, 20),
          };
          const reading = readFolder(f.label || tree.root, subjects);
          const fresh: string[] = [];
          const leftovers: { path: string[]; item: (typeof tree.pdfs)[number]["item"]; why: string; done?: boolean; answered?: boolean; by?: "ai" | "rules"; suggest?: string }[] = [];
          let haveHere = 0;
          let outside = 0;
          for (const { item, path } of tree.pdfs) {
            // The owner's word on a file from an earlier run page beats the rules.
            const d = decided.get(`${f.siteId}:${targetId(item)}`);
            if (d?.decision === "reject") {
              report.rejected = (report.rejected ?? 0) + 1;
              continue;
            }
            const c = d?.name && parseCambridgeName(d.name)
              ? { name: d.name, code: parseCambridgeName(d.name)!.code, why: "you accepted it on a run page" }
              : classifyFile(path, item.name, subjects);
            if (!c.name) {
              if (c.code && c.code !== job.params.code) summary.otherSubjects[c.code] = (summary.otherSubjects[c.code] ?? 0) + 1;
              else if ("notKept" in c && c.notKept) {
                // Its own Cambridge name says a type the library does not keep: not needed, no AI.
                report.notNeeded ??= { count: 0, examples: [] };
                report.notNeeded.count++;
                if (report.notNeeded.examples.length < 10) report.notNeeded.examples.push(`${[...path, item.name].join(" / ")}: ${c.why}`);
              }
              else leftovers.push({ path, item, why: c.why });
              continue;
            }
            summary.recognised++;
            const p = parseCambridgeName(c.name)!;
            if (p.code !== job.params.code) {
              summary.otherSubjects[p.code] = (summary.otherSubjects[p.code] ?? 0) + 1;
              continue;
            }
            summary.forThisSyllabus++;
            summary.years = summary.years ? [Math.min(summary.years[0], p.year), Math.max(summary.years[1], p.year)] : [p.year, p.year];
            if (!years.has(p.year) || !sessions.has(p.session)) {
              outside++;
              report.skippedNotRequested++;
              continue;
            }
            if (have.has(c.name) || report.candidates.some((x) => x.name === c.name)) {
              haveHere++;
              report.skippedHave++;
              continue;
            }
            const id = targetId(item);
            report.candidates.push({ name: c.name, url: `https://drive.google.com/file/d/${id}/view`, siteId: f.siteId, driveId: id, why: c.why });
            fresh.push(c.name);
          }
          // Files the rules could not name: the AI reads their folder path and name. Only names the
          // checklist asks for in this run come back as "named"; anything else goes to review.
          let aiNamed = 0;
          const askable = leftovers.slice(0, AI_BATCH * 5);
          if (askable.length && aiOn) await progress(findShare, `${step}: asking the AI about ${leftovers.length} unclear file${leftovers.length === 1 ? "" : "s"}`);
          for (let k = 0; k < askable.length && aiOn; k += AI_BATCH) {
            const batch = askable.slice(k, k + AI_BATCH);
            const answer = await ai("names", { files: batch.map((l) => ({ path: l.path, name: l.item.name })) });
            const verdicts = Array.isArray(answer?.files) ? (answer.files as { i: number; outcome: string; name?: string; why: string }[]) : [];
            for (const v of verdicts) {
              const l = batch[v.i];
              if (!l || l.answered) continue;
              l.answered = true;
              l.done = true;
              const where = [...l.path, l.item.name].join(" / ");
              if (v.outcome === "named" && v.name && parseCambridgeName(v.name)?.code === job.params.code) {
                summary.recognised++;
                summary.forThisSyllabus++;
                aiNamed++;
                if (have.has(v.name) || report.candidates.some((x) => x.name === v.name)) {
                  haveHere++;
                  report.skippedHave++;
                  continue;
                }
                const id = targetId(l.item);
                report.candidates.push({ name: v.name, url: `https://drive.google.com/file/d/${id}/view`, siteId: f.siteId, driveId: id, why: `worked out by AI: ${v.why}` });
                fresh.push(v.name);
              } else if (v.outcome === "not_needed") {
                report.notNeeded ??= { count: 0, examples: [] };
                report.notNeeded.count++;
                if (report.notNeeded.examples.length < 10) report.notNeeded.examples.push(`${where}: ${v.why}`);
              } else {
                l.done = false; // left for the owner below, with the AI's reason
                l.why = v.why || l.why;
                l.by = "ai";
                l.suggest = v.name;
              }
            }
          }
          // Files nobody could place: a download run reads their first page (below); the rest go to
          // "Needs your eye", where the owner can accept or reject them.
          for (const l of leftovers) {
            if (l.done) continue;
            const where = [...l.path, l.item.name].join(" / ");
            if (job.params.mode === "download" && unclear.length < (job.limits.coverReads ?? 60)) {
              unclear.push({ where, why: l.why, driveId: targetId(l.item), siteId: f.siteId, by: l.by ?? "rules", ...(l.suggest ? { suggest: l.suggest } : {}) });
              continue;
            }
            report.review ??= [];
            if (report.review.length < MAX_REVIEW) {
              report.review.push({ where, why: l.why, driveId: targetId(l.item), siteId: f.siteId, by: l.by ?? "rules", ...(l.suggest ? { suggest: l.suggest } : {}) });
            } else if (report.unmatched.length < 300) report.unmatched.push(`${where}: ${l.why}`);
          }
          summary.aiNamed = aiNamed;
          const subj = subjects.find((s) => s.code === (reading.code ?? (summary.forThisSyllabus ? job.params.code : "")));
          // A subject the library does not have yet still reads by its folder name ("History (0470)").
          summary.looksLike = subj
            ? `${subj.qualification} ${subj.name} ${subj.code}`
            : reading.code
              ? `${(f.label || tree.root).replace(/\s+-\s+/g, ", ")}, a subject not in the library yet`
              : "no subject in the folder name";
          report.driveFolders.push(summary);
          report.pagesVisited++;
          report.linksFound += tree.pdfs.length;
          const others = Object.entries(summary.otherSubjects).map(([code, k]) => `${code}: ${k}`).join(", ");
          await progress(findShare, step,
            `Read Google Drive folder "${tree.root}": looks like ${summary.looksLike}. ${tree.pdfs.length} PDFs in ${tree.folders} folders` +
            `${summary.years ? `, ${summary.years[0] === summary.years[1] ? summary.years[0] : `${summary.years[0]} to ${summary.years[1]}`}` : ""}` +
            `${tree.truncated ? " (stopped at the folder limit)" : ""}` +
            `${summary.yearsHeld ? `; it holds ${summary.yearsHeld[0]} to ${summary.yearsHeld[1]}` : ""}` +
            `${tree.skipped ? `; ${tree.skipped} folder${tree.skipped === 1 ? "" : "s"} not opened (outside this run${aiSkipped.length ? `, ${aiSkipped.length} judged not useful by the AI` : ""})` : ""}` +
            `. ${summary.forThisSyllabus} recognised as ${job.params.code} papers${aiNamed ? ` (${aiNamed} by the AI)` : ""}` +
            `${others ? `, others for subjects not in this run (${others})` : ""}; ${tree.pdfs.length - summary.recognised - Object.values(summary.otherSubjects).reduce((a, b) => a + b, 0)} not named. ` +
            (fresh.length ? `${fresh.length} new: ${summariseFiles(fresh)}` : "Nothing new for this run") +
            `${haveHere ? `; ${haveHere} already in the library` : ""}${outside ? `; ${outside} for years or sessions not in this run` : ""}.`);
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          // Google answers 404 both for a deleted folder and for one not shared with "anyone with the link".
          const why = e instanceof DriveError
            ? e.status === 404 ? "Google Drive says it does not exist or is not shared publicly. Open its link to check it still opens for anyone with the link"
              : e.status === 403 ? "Google Drive refused access: it is not shared as \"anyone with the link\", or the API key is limited"
              : e.status === 400 ? "Google Drive refused the API key. Check the GOOGLE_DRIVE_API secret in GitHub"
              : e.message
            : "it could not be read";
          const title = f.label || "An unnamed Google Drive folder";
          report.pageErrors.push({ url: title, status: why });
          report.driveFolders.push({ folderId: f.folderId, name: title, looksLike: "", folders: 0, pdfs: 0, recognised: 0, forThisSyllabus: 0, otherSubjects: {}, years: null, truncated: false, error: why });
          await progress(findShare, step, `${title} could not be read: ${why}.`);
        }
      }
    }
  }

  const found = report.candidates.map((c) => c.name);
  await progress(findShare, "Pages read", found.length
    ? `Found ${found.length} file${found.length === 1 ? "" : "s"} to ${job.params.mode === "dry" ? "list (not downloaded in a dry run)" : "download"}: ${summariseFiles(found, 6)}.`
    : `Nothing new to ${job.params.mode === "dry" ? "list" : "download"}: every matching file is already in the library (${report.skippedHave}).`);

  if (job.params.mode === "download") {
    const todo = report.candidates.slice(0, job.limits.maxFiles);
    // Google limits downloads from busy shared files. After a refusal the agent waits and tries
    // once more; after DRIVE_STOP_AFTER refusals in a row it stops asking Drive for this run, so
    // it does not hammer Google, and the rest are left for a later run.
    const DRIVE_STOP_AFTER = 3;
    let driveRefusals = 0;
    let drivePaused = "";
    const fromDrive = async (id: string) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await sleep(TEST_MODE ? 0 : 2_000); // gentler than listing: one download every few seconds
          const bytes = await drive!.download(id, job.limits.maxFileBytes);
          driveRefusals = 0;
          return { status: 200, bytes, type: "application/pdf", reason: "" };
        } catch (e) {
          if (!(e instanceof DriveError)) return { status: 0, bytes: new Uint8Array(), type: "", reason: "drive_error" };
          const why = driveRefusal(e);
          log(`Google Drive refused a download: ${e.status} ${e.reason || "(no reason given)"}`);
          const limited = why === "drive_quota" || why === "drive_rate" || why === "drive_throttled";
          if (limited && attempt === 0 && driveRefusals < DRIVE_STOP_AFTER - 1) {
            await sleep(TEST_MODE ? 0 : 30_000);
            continue;
          }
          if (limited) driveRefusals++;
          return { status: e.status, bytes: new Uint8Array(), type: "", reason: why };
        }
      }
    };
    const pauseCheck = async (pct: number, step: string, reason: string | undefined) => {
      if (driveRefusals >= DRIVE_STOP_AFTER && !drivePaused) {
        drivePaused = reason || "drive_throttled";
        report.drivePaused = { reason: drivePaused, afterStored: report.stored.length };
        await progress(pct, step, `Google Drive refused ${DRIVE_STOP_AFTER} downloads in a row (${reasonText(drivePaused)}). The agent stopped asking Drive for this run; run the download again later for the rest.`);
      }
    };
    const store = async (name: string, bytes: Uint8Array, siteId: string, url: string) => {
      const res = await api("/api/agent/file", bytes, { "x-agent-job": JOB_ID, "x-agent-file": name, "x-agent-site": siteId, "x-agent-url": url }, "application/pdf");
      const out = res.data as { ok?: boolean; reason?: string; error?: string } | null;
      return { ok: res.status === 200 && !!out?.ok, reason: out?.reason ?? out?.error ?? `worker_${res.status}`, stop: res.status === 429 || res.status === 409 };
    };
    const planned = new Set(todo.map((c) => c.name));
    let n = 0;
    for (const c of todo) {
      n++;
      const pct = findShare + Math.round(((n - 1) / Math.max(todo.length, 1)) * (99 - findShare));
      const step = `Downloading file ${n} of ${todo.length}`;
      await progress(pct, step);
      const failedBefore = report.failed.length;
      let lastBytes = 0;
      try {
        if (c.driveId && drivePaused) {
          report.failed.push({ name: c.name, reason: "drive_paused" });
          continue;
        }
        const r: { status: number; bytes: Uint8Array; type: string; reason?: string } = c.driveId && drive
          ? await fromDrive(c.driveId)
          : await politeFetch(c.url, job.limits.maxFileBytes);
        await pauseCheck(pct, step, r.reason);
        if (r.status !== 200) {
          report.failed.push({ name: c.name, reason: r.reason || `http_${r.status}` });
        } else {
          lastBytes = r.bytes.length;
          // Every download is checked against its first page before it is stored.
          const { cover } = await coverOf(r.bytes, codes);
          let name = c.name;
          const other = cover.name && cover.name !== c.name ? cover.name : null;
          const otherCode = !cover.name && cover.code && cover.code !== job.params.code ? cover.code : null;
          if (other && parseCambridgeName(other)!.code === job.params.code && !have.has(other) && !report.stored.includes(other) && !planned.has(other)) {
            name = other;
            report.renamed ??= [];
            report.renamed.push({ from: c.name, to: other });
          } else if (other || otherCode) {
            report.heldBack = (report.heldBack ?? 0) + 1;
            report.failed.push({ name: c.name, reason: "cover_mismatch" });
            toReview({
              where: `${c.name}, from ${c.driveId ? "Google Drive" : c.url}`,
              why: other ? `held back: the name says ${c.name} but the first page says ${other}` : `held back: the first page is for syllabus ${otherCode}`,
              ...(c.driveId ? { driveId: c.driveId, siteId: c.siteId } : {}), ...(other ? { suggest: other } : {}), by: "rules",
            });
            continue;
          }
          const out = await store(name, r.bytes, c.siteId, c.url);
          if (out.ok) report.stored.push(name);
          else report.failed.push({ name, reason: out.reason });
          if (out.stop) break; // run limit reached or run closed
        }
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        report.failed.push({ name: c.name, reason: "download_failed" });
      }
      const failed = report.failed.length > failedBefore ? report.failed[report.failed.length - 1] : null;
      const why = failed ? reasonText(failed.reason) : "";
      const bytes = lastBytes;
      const as = report.renamed?.find((x) => x.from === c.name)?.to ?? c.name;
      await progress(pct, step, failed
        ? { text: `${n} of ${todo.length}: ${c.name} not stored (${why})`, file: c.name, outcome: "failed", reason: failed.reason }
        : { text: `${n} of ${todo.length}: ${as} stored${as !== c.name ? ` (the first page showed it is not ${c.name})` : ""}`, file: as, outcome: "stored", bytes });
    }

    // Front page reader: unclear Drive files are downloaded and named from their first page
    // (rules, then the AI). Named files for this subject are stored; the rest go to "Needs your eye".
    let k = 0;
    for (const u of unclear) {
      k++;
      if (drivePaused || !drive) {
        toReview({ ...u, why: `${u.why}; its first page was not read (Google Drive was refusing downloads)` });
        continue;
      }
      const step = `Reading the first page of unclear file ${k} of ${unclear.length}`;
      await progress(99, step);
      const r = await fromDrive(u.driveId);
      await pauseCheck(99, step, r.reason);
      if (r.status !== 200) {
        toReview({ ...u, why: `${u.why}; its first page could not be read (${reasonText(r.reason || `http_${r.status}`)})` });
        continue;
      }
      report.cover ??= { read: 0, named: 0, aiNamed: 0 };
      report.cover.read++;
      const { text, cover } = await coverOf(r.bytes, codes);
      let name = cover.name;
      let why = cover.why;
      let byAi = false;
      if (!name && text) {
        const answer = await ai("cover", { where: u.where, text: text.slice(0, 3000) });
        const f = answer?.file as { outcome?: string; name?: string; why?: string } | undefined;
        if (f?.outcome === "named" && f.name) {
          name = f.name;
          why = `the AI read the first page: ${f.why ?? ""}`.trim();
          byAi = true;
        } else if (f?.outcome === "not_needed") {
          report.notNeeded ??= { count: 0, examples: [] };
          report.notNeeded.count++;
          if (report.notNeeded.examples.length < 10) report.notNeeded.examples.push(`${u.where}: first page read by the AI: ${f.why ?? ""}`);
          report.autoRejected ??= [];
          report.autoRejected.push({ siteId: u.siteId, driveId: u.driveId, where: u.where });
          continue;
        } else if (f?.name) {
          toReview({ ...u, why: `first page read by the AI: ${f.why ?? "not a file this run looks for"}`, suggest: f.name, by: "ai" });
          continue;
        }
      }
      const pn = name ? parseCambridgeName(name) : null;
      if (!pn || pn.code !== job.params.code) {
        toReview({ ...u, why: pn ? `the first page says ${name}, another subject` : `${why}`, ...(name ? { suggest: name } : {}), by: byAi ? "ai" : "rules" });
        continue;
      }
      if (have.has(name!) || report.stored.includes(name!)) {
        report.skippedHave++;
        continue;
      }
      const out = await store(name!, r.bytes, u.siteId, `https://drive.google.com/file/d/${u.driveId}/view`);
      if (out.ok) {
        report.stored.push(name!);
        report.cover.named++;
        if (byAi) report.cover.aiNamed++;
        await progress(99, step, { text: `${name} stored, worked out from the first page of ${u.where} (${why})`, file: name!, outcome: "stored", bytes: r.bytes.length });
      } else {
        report.failed.push({ name: name!, reason: out.reason });
        if (out.stop) break;
      }
    }
    await progress(99, "Finishing", report.stored.length
      ? `Done: ${report.stored.length} stored (${summariseFiles(report.stored, 6)})${report.failed.length ? `; ${report.failed.length} not stored, see the list below` : ""}.`
      : `Done: nothing was stored${report.failed.length ? `; ${report.failed.length} not stored, see the list below` : ""}.`);
  }
  await summarise(job);
}

/**
 * Library check: reads the first page of every stored file of the run's years and sessions and
 * lists the ones whose first page says they are another file. Nothing is changed here; the run
 * page offers rename or remove for each.
 */
async function checkLibrary(job: Job, codes: string[], years: Set<number>, sessions: Set<string>) {
  const docs = (job.storedDocs ?? []).filter((d) => {
    const p = parseCambridgeName(d.fileName);
    return p && years.has(p.year) && sessions.has(p.session);
  });
  const check: NonNullable<Report["check"]> = { read: 0, matched: 0, unreadable: 0, items: [] };
  report.check = check;
  await progress(5, "Checking the library", `Library check: reading the first page of ${docs.length} stored file${docs.length === 1 ? "" : "s"}.`);
  let n = 0;
  for (const d of docs) {
    n++;
    const step = `Checking file ${n} of ${docs.length}`;
    if (n % 10 === 1) await progress(5 + Math.round((n / Math.max(docs.length, 1)) * 90), step);
    const r = await apiBytes("/api/agent/doc", { jobId: JOB_ID, id: d.id });
    if (r.status === 409) throw new Cancelled("the run was cancelled or closed in the admin panel");
    if (r.status !== 200) {
      check.unreadable++;
      continue;
    }
    check.read++;
    const { cover } = await coverOf(r.bytes, codes);
    if (cover.name === d.fileName) check.matched++;
    else if (cover.name || (cover.code && cover.code !== job.params.code)) {
      if (check.items.length < 300) check.items.push({ id: d.id, fileName: d.fileName, coverName: cover.name, why: cover.why });
      await progress(5 + Math.round((n / Math.max(docs.length, 1)) * 90), step, `${d.fileName}: ${cover.name ? `the first page says it is ${cover.name}` : cover.why}`);
    } else check.unreadable++;
  }
  const subj = (job.subjects ?? []).find((s) => s.code === job.params.code);
  const draft = checkSummary({
    subject: subj ? `${subj.qualification} ${subj.name} (${subj.code})` : job.params.code,
    files: docs.length, matched: check.matched, mismatched: check.items.length, unreadable: check.unreadable,
  });
  const answer = await ai("summary", { draft });
  report.summary = typeof answer?.summary === "string" ? answer.summary : draft;
  report.summaryBy = typeof answer?.summary === "string" ? "ai" : "rules";
  report.ai = { calls: aiCalls, ...(aiNote ? { note: aiNote } : {}) };
  await progress(99, "Summary", `Summary: ${report.summary}`);
}

/**
 * The run in plain words for the top of the run page. Rules write the facts (ruleSummary); the
 * AI may only reword them, and the Worker drops any rewording that changes a number or invents a
 * limit. Without AI the rules' text is shown as it is.
 */
async function summarise(job: Job) {
  const drives = report.driveFolders ?? [];
  const subj = (job.subjects ?? []).find((s) => s.code === job.params.code);
  const draft = ruleSummary({
    subject: subj ? `${subj.qualification} ${subj.name} (${subj.code})` : job.params.code,
    mode: job.params.mode,
    years: job.params.years,
    sessions: job.params.sessions.map((s) => SESSION_LABELS[s] ?? s),
    allSessions: ["m", "s", "w", "y"].every((s) => job.params.sessions.includes(s)),
    websitePages: Math.max(0, report.pagesVisited - drives.filter((d) => !d.error).length),
    driveFolders: drives.map((d) => ({ name: d.name, error: d.error, yearsHeld: d.yearsHeld ?? d.years, notOpened: d.skippedFolders, truncated: d.truncated })),
    driveOtherSubjects: report.driveSkipped ?? 0,
    found: report.candidates.length,
    have: report.skippedHave,
    outside: report.skippedNotRequested,
    stored: report.stored.length,
    failed: report.failed.length,
    notNeeded: report.notNeeded?.count ?? 0,
    review: report.review?.length ?? 0,
    rejected: report.rejected ?? 0,
    coverRead: report.cover?.read ?? 0,
    coverNamed: report.cover?.named ?? 0,
    renamed: report.renamed?.length ?? 0,
    heldBack: report.heldBack ?? 0,
    notNamed: report.unmatched.length,
    maxFiles: job.limits.maxFiles,
    drivePaused: report.drivePaused
      ? { afterStored: report.drivePaused.afterStored, notTried: report.failed.filter((x) => x.reason === "drive_paused").length }
      : null,
  });
  const answer = await ai("summary", { draft });
  if (typeof answer?.summary === "string") {
    report.summary = answer.summary;
    report.summaryBy = "ai";
  } else {
    report.summary = draft;
    report.summaryBy = "rules";
  }
  report.ai = { calls: aiCalls, ...(aiNote ? { note: aiNote } : {}) };
  await progress(99, "Summary", `Summary: ${report.summary}`);
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
