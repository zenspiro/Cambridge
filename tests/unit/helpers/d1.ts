// A tiny D1 stand-in over Node's built-in SQLite, with every migration applied.
// Lets unit tests run the real SQL from src/lib against a real database.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { Bucket, Db } from "../../../src/lib/db.ts";

export function testDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  type V = string | number | null;
  return {
    raw,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const stmt = raw.prepare(sql);
          const args = values as V[];
          return {
            async first<T>() {
              return (stmt.get(...args) as T | undefined) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...args) as T[] };
            },
            async run() {
              return stmt.run(...args);
            },
          };
        },
      };
    },
  };
}

/** In-memory R2 stand-in. */
export function testBucket(opts: { failPut?: boolean } = {}): Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, value, o?: { sha256?: string }) {
      if (opts.failPut) throw new Error("storage down");
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      // Like R2: a given SHA-256 is checked against the bytes before anything is written.
      if (o?.sha256) {
        const d = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((x) => x.toString(16).padStart(2, "0")).join("");
        if (d !== o.sha256) throw new Error("BadDigest: the SHA-256 does not match");
      }
      objects.set(key, bytes);
    },
    async get(key) {
      const v = objects.get(key);
      return v ? { body: new Blob([v as BlobPart]).stream(), size: v.length } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}
