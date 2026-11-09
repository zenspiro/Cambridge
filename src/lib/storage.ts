// Storage on Home (owner, 9 Nov 2026: how much database and bucket space is used). The database's size as D1 reports it
// after a query; Cambridge papers (SOURCE) from our own rows (every stored file's size); app files (FILES: pictures,
// readings, figures) by listing the bucket. Kept in the setting `storage_stat` for STORAGE.cacheMs so Home stays quick.
// Estimates: Cloudflare's dashboard is the bill. Takes the database and bucket as parameters. No Next imports.
import type { Db } from "./db.ts";
import { STORAGE } from "./config.ts";

/** The part of R2's binding used to list a bucket. */
export interface ListBucket {
  list(options: { cursor?: string; limit?: number }): Promise<{ objects: { size: number }[]; truncated: boolean; cursor?: string }>;
}

export type StorageStat = {
  at: number;
  /** The database in bytes; null when D1 does not say (local tests). */
  db: number | null;
  papers: { bytes: number; count: number };
  files: { bytes: number; count: number; partial: boolean };
};

/** The database's size from a query's metadata (D1 reports `size_after`). */
export async function dbBytes(db: Db): Promise<number | null> {
  const r = (await db.prepare(`SELECT 1`).bind().run()) as { meta?: { size_after?: unknown } } | null;
  const n = r?.meta?.size_after;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Every object in a bucket, up to STORAGE.maxListCalls pages. */
export async function bucketBytes(bucket: ListBucket, maxCalls: number = STORAGE.maxListCalls): Promise<{ bytes: number; count: number; partial: boolean }> {
  let bytes = 0, count = 0, cursor: string | undefined;
  for (let i = 0; i < maxCalls; i++) {
    const page = await bucket.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) {
      bytes += typeof o.size === "number" && o.size > 0 ? o.size : 0;
      count++;
    }
    if (!page.truncated || !page.cursor) return { bytes, count, partial: false };
    cursor = page.cursor;
  }
  return { bytes, count, partial: true };
}

/** A stored count, made safe; null when absent or broken. Pure. */
export function cleanStat(v: unknown): StorageStat | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);
  const part = (x: unknown) => {
    const p = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    return { bytes: n(p.bytes) ?? 0, count: n(p.count) ?? 0 };
  };
  if (!o || n(o.at) === null) return null;
  const f = o.files && typeof o.files === "object" ? (o.files as Record<string, unknown>) : {};
  return { at: n(o.at)!, db: n(o.db), papers: part(o.papers), files: { ...part(o.files), partial: f.partial === true } };
}

/** The storage count: the kept one while fresh, else counted again and kept. `fresh` forces a new count. */
export async function storageStat(db: Db, files: ListBucket, now = Date.now(), fresh = false): Promise<StorageStat> {
  if (!fresh) {
    const row = await db.prepare(`SELECT value FROM setting WHERE key = 'storage_stat'`).bind().first<{ value: string }>();
    let kept: StorageStat | null = null;
    try {
      kept = cleanStat(row ? JSON.parse(row.value) : null);
    } catch {
      kept = null;
    }
    if (kept && now - kept.at < STORAGE.cacheMs) return kept;
  }
  const [size, papers, app] = await Promise.all([
    dbBytes(db),
    db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS count FROM source_document WHERE status = 'stored'`).bind().first<{ bytes: number; count: number }>(),
    bucketBytes(files),
  ]);
  const stat: StorageStat = { at: now, db: size, papers: { bytes: papers?.bytes ?? 0, count: papers?.count ?? 0 }, files: app };
  await db
    .prepare(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('storage_stat', ?1, 'system', ?2)
              ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2`)
    .bind(JSON.stringify(stat), now)
    .run();
  return stat;
}

/** Bytes in words with one decimal: "412.3 MB", "1.2 GB" (decimal units, as Cloudflare counts). Pure. */
export function sizeWords(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1000 ** 2) return `${(n / 1000).toFixed(1)} KB`;
  if (n < 1000 ** 3) return `${(n / 1000 ** 2).toFixed(1)} MB`;
  return `${(n / 1000 ** 3).toFixed(2)} GB`;
}
