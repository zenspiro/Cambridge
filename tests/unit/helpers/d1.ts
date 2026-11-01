// A tiny D1 stand-in over Node's built-in SQLite, with every migration applied.
// Lets unit tests run the real SQL from src/lib against a real database.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { Db } from "../../../src/lib/auth/session.ts";

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
