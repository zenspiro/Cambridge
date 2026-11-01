import { SESSION_LABELS } from "../config.ts";
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

export function readEvents(json: string): { at: number; text: string }[] {
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
  candidates?: { name: string; url: string }[];
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
