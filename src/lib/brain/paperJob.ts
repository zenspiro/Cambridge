// What the brain script gets for one paper (the job endpoint, and each next paper of a Read all batch). No Next imports.
import type { Db, Bucket } from "../db.ts";
import { BRAIN } from "../config.ts";
import { listSubjects, subjectLabel } from "../library/catalog.ts";
import { describeFile, loadPapers, paperLookup } from "../library/papers.ts";
import { PAPER_KINDS, paperDoc, readingForRun } from "./paperRead.ts";
import type { PaperKind } from "./paper.ts";
import type { AiModels } from "./aiSetup.ts";
import type { PaperScope, Batch } from "./runs.ts";

export async function paperJobPayload(db: Db, files: Bucket, docId: string, scope: PaperScope, batch: Batch | undefined, models: AiModels, limits: Record<string, unknown>, reader?: string, check = false, shadow = false, second = false): Promise<Record<string, unknown> | null> {
  const doc = await paperDoc(db, docId);
  if (!doc || !PAPER_KINDS.includes(doc.docType as PaperKind)) return null;
  const [{ papers }, subjects, size, prior] = await Promise.all([
    loadPapers(db, doc.code), listSubjects(db),
    db.prepare(`SELECT size_bytes FROM source_document WHERE id = ?1`).bind(doc.id).first<{ size_bytes: number }>(),
    // Read again for the score: a fresh reading, as if the paper had never been read (nothing kept, nothing held).
    shadow ? Promise.resolve({ content: null, gemini: null, open: [], hold: { fingerprints: [], keys: [], items: [] } }) : readingForRun(db, files, doc),
  ]);
  return {
    task: "paper",
    kind: doc.docType,
    subject: subjectLabel(subjects, doc.code),
    paper: describeFile(doc.fileName, doc.syllabusId, paperLookup(papers)),
    pdfBytes: size?.size_bytes ?? 0,
    scope,
    prior,
    ...(batch ? { batch: { at: batch.docs.indexOf(docId) + 1, of: batch.docs.length, label: batch.label, ...(batch.again ? { again: true } : {}) } } : {}),
    // "Read with" (owner, 9 Nov 2026): this reading's own Claude model, or Gemini alone; else the saved Reading AI.
    models: { claude: models.claude, gemini: models.gemini, drawing: models.drawing, reading: reader && reader !== "gemini" ? reader : models.reading },
    readWith: reader === "gemini" ? "gemini" : "claude",
    // Run the checks again (owner, 9 Nov 2026): no AI, the stored reading checked with today's checks.
    ...(check ? { check: true } : {}),
    // Check with Gemini (owner, 12 Nov 2026): Gemini reads to check a reading Claude made alone.
    ...(check && second ? { second: true } : {}),
    limits,
  };
}

/** The limits every brain run gets. */
export const brainLimits = () => ({
  attempts: BRAIN.attempts,
  claudeMaxTokens: BRAIN.claudeMaxTokens,
  claudeEffort: BRAIN.claudeEffort,
  geminiMaxTokens: BRAIN.geminiMaxTokens,
  maxPdfBytes: BRAIN.maxPdfBytes,
  geminiTries: BRAIN.geminiTries,
  geminiMaxWaitMs: BRAIN.geminiMaxWaitMs,
  checkModels: BRAIN.checkModels,
  checkDelayMs: BRAIN.checkDelayMs,
  geminiRetryWaitsMs: BRAIN.geminiRetryWaitsMs,
  paperEffort: BRAIN.paperEffort,
  drawEffort: BRAIN.drawEffort,
});
