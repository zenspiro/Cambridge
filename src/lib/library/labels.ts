import { DOC_TYPE_LABELS, SESSION_LABELS } from "../config.ts";
import type { StoreReason } from "./store.ts";

export const REASON_LABELS: Record<StoreReason, string> = {
  name: "Not a Cambridge file name (like 0625_s23_qp_42.pdf)",
  year: "Outside the library years",
  size: "Empty or too big",
  not_pdf: "Not a PDF",
  no_syllabus: "No syllabus version set up for that year",
  same_name: "Already in the library",
  same_content: "Same file is already stored under another name",
  storage: "Could not be saved, please try again",
  no_access: "Not one of your subjects (no edit access)",
};

export function describeDoc(d: { doc_type: string; paper: number | null; variant: number | null }): string {
  const t = DOC_TYPE_LABELS[d.doc_type] ?? d.doc_type;
  if (d.paper === null) return t;
  return `${t}, paper ${d.paper}${d.variant ? ` variant ${d.variant}` : ""}`;
}

export function sessionLabel(s: string, year: number): string {
  return s === "y" ? `Specimen (${year})` : `${SESSION_LABELS[s] ?? s} ${year}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Time with seconds, for the live activity log. */
export const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Karachi" });

export const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
