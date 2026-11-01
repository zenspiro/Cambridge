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
    async put(key, value) {
      if (opts.failPut) throw new Error("storage down");
      objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
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
