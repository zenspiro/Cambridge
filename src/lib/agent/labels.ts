import { SESSION_LABELS } from "../config.ts";
import { REASON_LABELS } from "../library/labels.ts";
import type { RunParams } from "./runs.ts";

export const STATUS_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** "3 min 20 s", "45 s". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}

export function readEvents(json: string): import("./runs.ts").RunEvent[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((e) => e && typeof e.at === "number" && typeof e.text === "string") : [];
  } catch {
    return [];
  }
}

export function describeRun(p: RunParams): string {
  const mode = p.mode === "dry" ? "Dry run" : "Download";
  const sessions = p.sessions.map((s) => SESSION_LABELS[s] ?? s).join(", ");
  return `${mode}: ${p.years.join(", ")} (${sessions})`;
}

/** What the agent sends back in its report. Read defensively: shown as text only. */
export type RunReport = {
  pagesVisited?: number;
  linksFound?: number;
  candidates?: { name: string; url: string; why?: string }[];
  driveFolders?: {
    folderId: string; name: string; looksLike: string; folders: number; pdfs: number; recognised: number;
    forThisSyllabus: number; otherSubjects: Record<string, number>; years: [number, number] | null; truncated: boolean; error?: string;
    skippedFolders?: number; yearsHeld?: [number, number] | null; aiSkipped?: string[]; aiNamed?: number;
  }[];
  /** Plain-English summary, and whether the AI or the rules wrote it. */
  summary?: string;
  summaryBy?: "ai" | "rules";
  ai?: { calls: number; note?: string };
  /** Files the agent could not place, for a person to decide (read with readReviewItems). */
  review?: unknown[];
  /** Files the AI judged not to be original Cambridge files. */
  notNeeded?: { count: number; examples: string[] };
  /** Drive folders not read because their names are for other subjects. */
  driveSkipped?: number;
  stored?: string[];
  skippedHave?: number;
  skippedNotRequested?: number;
  failed?: { name: string; reason: string }[];
  unmatched?: string[];
  robotsBlocked?: string[];
  pageErrors?: { url: string; status: string }[];
  error?: string;
};

export function readReport(json: string): RunReport {
  try {
    const r = JSON.parse(json);
    return r && typeof r === "object" ? (r as RunReport) : {};
  } catch {
    return {};
  }
}

export const arr = <T>(v: T[] | undefined, max = 1000): T[] => (Array.isArray(v) ? v.slice(0, max) : []);

/** Why Google Drive refused a download, in words. */
export const DRIVE_REASONS: Record<string, string> = {
  drive_quota: "Google Drive's download limit for this file was reached (common for busy shared files); it lifts with time",
  drive_rate: "Google Drive asked the agent to slow down",
  drive_forbidden: "Google Drive refused the download (the owner may have turned downloads off)",
  drive_missing: "Google Drive could not find the file any more",
  drive_too_big: "the file is larger than the library allows",
  drive_error: "Google Drive did not answer properly",
  drive_paused: "not tried: Google Drive was refusing downloads, so the agent stopped asking. Run the download again later",
};

/** "Not a PDF", "the website answered 404", or the code itself. */
export function reasonText(reason: string | undefined): string {
  if (!reason) return "";
  const known = (REASON_LABELS as Record<string, string>)[reason];
  if (known) return known;
  if (reason in DRIVE_REASONS) return DRIVE_REASONS[reason]!;
  if (reason.startsWith("http_")) return `the website answered ${reason.slice(5)}`;
  if (reason === "download_failed") return "the download did not finish";
  return reason.replace(/_/g, " ");
}
