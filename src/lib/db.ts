// The slice of the D1 API this app uses. Functions take it as a parameter, so
// unit tests run them on Node's SQLite (tests/unit/helpers/d1.ts). No imports.
export interface Db {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

/** The slice of the R2 API this app uses (tests use an in-memory map). */
export interface Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; sha256?: string },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
}
