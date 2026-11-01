// Storing one Cambridge file: checks, fingerprint, race-safe reservation, storage.
// Shared by manual upload now and the agent later. Takes db and bucket as parameters.
import { LIBRARY } from "../config.ts";
import type { Bucket, Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { parseCambridgeName, storageKey } from "./names.ts";
import * as Q from "./queries.ts";

export type StoreReason =
  | "name" // not a Cambridge file name
  | "year" // outside the library years
  | "size" // empty or too big
  | "not_pdf" // does not start like a PDF
  | "no_syllabus" // no syllabus version for that code and year
  | "same_name" // a file with this name is already stored
  | "same_content" // the same file is stored under another name
  | "storage"; // storage write failed (logged with a reference)

export type StoreOutcome =
  | { fileName: string; ok: true; id: string }
  | { fileName: string; ok: false; reason: StoreReason };

export type StoreInput = {
  fileName: string;
  bytes: Uint8Array;
  actorId: string;
  origin: "upload" | "agent";
  jobId?: string | null;
  sourceUrl?: string | null;
  sourceSiteId?: string | null;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function looksLikePdf(b: Uint8Array): boolean {
  // The header may sit after a few junk bytes; the PDF spec allows up to 1024.
  const limit = Math.min(b.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= limit; i++) {
    if (PDF_MAGIC.every((x, j) => b[i + j] === x)) return true;
  }
  return false;
}

async function sha256HexBytes(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function storeDocument(db: Db, bucket: Bucket, input: StoreInput, now = Date.now()): Promise<StoreOutcome> {
  const shown = String(input.fileName ?? "").slice(0, 80);
  const fail = (reason: StoreReason): StoreOutcome => ({ fileName: shown, ok: false, reason });

  const p = parseCambridgeName(input.fileName);
  if (!p) return fail("name");
  if (p.year < LIBRARY.fromYear || p.year > LIBRARY.toYear) return fail("year");
  if (input.bytes.length === 0 || input.bytes.length > LIBRARY.maxFileBytes) return fail("size");
  if (!looksLikePdf(input.bytes)) return fail("not_pdf");

  const syl = await db.prepare(Q.SYLLABUS_FOR_YEAR).bind(p.code, p.year).first<{ id: string }>();
  if (!syl) return fail("no_syllabus");

  const sha = await sha256HexBytes(input.bytes);
  const key = storageKey(p);
  await db.prepare(Q.DROP_STALE_PENDING).bind(now - 3_600_000).run();
  const reserved = await db
    .prepare(Q.RESERVE_DOCUMENT)
    .bind(
      randomId(), syl.id, p.session, p.year, p.paper, p.variant, p.docType, p.fileName, key, sha,
      input.bytes.length, input.sourceUrl ?? null, input.sourceSiteId ?? null, input.origin,
      input.jobId ?? null, input.actorId, now,
    )
    .first<{ id: string }>();
  if (!reserved) {
    const clash = await db.prepare(Q.FIND_CLASH).bind(p.fileName, sha).first<{ file_name: string }>();
    return fail(clash?.file_name === p.fileName ? "same_name" : "same_content");
  }

  try {
    await bucket.put(key, input.bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { sha256: sha },
      sha256: sha,
    });
  } catch (err) {
    await db.prepare(Q.DROP_PENDING).bind(reserved.id).run();
    throw Object.assign(new Error("source storage write failed"), { cause: err, fileName: p.fileName });
  }
  await db.prepare(Q.MARK_STORED).bind(reserved.id).run();
  await audit(
    db,
    { actorId: input.actorId, action: `source.${input.origin}`, entity: "source_document", entityId: reserved.id },
    now,
  );
  return { fileName: p.fileName, ok: true, id: reserved.id };
}
