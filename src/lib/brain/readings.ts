// Finished readings kept between runs (owner, 7 Nov 2026: "I don't need my credits wasted for such errors"). When a
// topic tree run stops after an AI has finished reading (a later step failed, the other AI was down), that reading is
// kept in R2 FILES, so pressing Draft again reuses it instead of paying for it twice. A reading is reused only for
// the same syllabus version, the same model and the same PDF (its SHA-256); a saved tree clears them, so a Redraft
// after success reads afresh. Takes the database and bucket as parameters. No Next imports.
import type { Bucket, Db } from "../db.ts";
import { BRAIN } from "../config.ts";
import { SPEND_MODEL_RE } from "./spend.ts";

export type ReadingProvider = "claude" | "gemini";
type Stored = { model: string; pdfSha: string; at: number; raw: unknown };

const key = (syllabusId: string, provider: ReadingProvider) => `brain/readings/${encodeURIComponent(syllabusId)}/${provider}.json`;
const enc = new TextEncoder();

/** The syllabus PDF's fingerprint (the stored file's SHA-256), or null without one. */
export async function syllabusSha(db: Db, syllabusId: string): Promise<string | null> {
  const r = await db
    .prepare(`SELECT sha256 FROM source_document WHERE syllabus_id = ?1 AND doc_type = 'sy' AND status = 'stored' ORDER BY acquired_at DESC LIMIT 1`)
    .bind(syllabusId)
    .first<{ sha256: string }>();
  return r?.sha256 ?? null;
}

export async function saveReading(db: Db, bucket: Bucket, syllabusId: string, provider: unknown, model: unknown, raw: unknown, now = Date.now()): Promise<"ok" | "bad" | "too_big"> {
  if ((provider !== "claude" && provider !== "gemini") || typeof model !== "string" || !SPEND_MODEL_RE.test(model) || !model.startsWith(`${provider}-`)) return "bad";
  if (!raw || typeof raw !== "object") return "bad";
  const pdfSha = await syllabusSha(db, syllabusId);
  if (!pdfSha) return "bad";
  const body = enc.encode(JSON.stringify({ model, pdfSha, at: now, raw } satisfies Stored));
  if (body.length > BRAIN.maxTreeBytes * 2) return "too_big";
  await bucket.put(key(syllabusId, provider), body, { httpMetadata: { contentType: "application/json" } });
  return "ok";
}

/** A kept reading for this version, model and current PDF, or null. */
export async function loadReading(db: Db, bucket: Bucket, syllabusId: string, provider: ReadingProvider, model: string): Promise<{ raw: unknown; at: number } | null> {
  const obj = await bucket.get(key(syllabusId, provider));
  if (!obj) return null;
  try {
    const s = JSON.parse(await new Response(obj.body).text()) as Stored;
    const pdfSha = await syllabusSha(db, syllabusId);
    return s.model === model && pdfSha !== null && s.pdfSha === pdfSha && s.raw ? { raw: s.raw, at: s.at } : null;
  } catch {
    return null;
  }
}

export async function clearReadings(bucket: Bucket, syllabusId: string): Promise<void> {
  await Promise.all((["claude", "gemini"] as const).map((p) => bucket.delete(key(syllabusId, p))));
}
