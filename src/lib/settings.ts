// Settings stored in the database (brief 15.3), changed from /admin/settings.
import type { Db } from "./db.ts";
import { audit } from "./auth/session.ts";

export type ExamSession = "m" | "s" | "w";
export type EssentialVariants = Record<ExamSession, number[]>;
export type LibrarySettings = {
  fromYear: number;
  toYear: number;
  lastSession: { year: number; session: ExamSession };
  /** Variants that must be present for a session to count as complete. Others are extras. */
  essentialVariants: EssentialVariants;
};

/** Owner decision (1 Nov 2026): Pakistan sits variant 2. Syllabuses can override this. */
export const ESSENTIAL_DEFAULTS: EssentialVariants = { m: [2], s: [2], w: [2] };

/** Used only if the row is missing or damaged, so pages never break. */
export const LIBRARY_DEFAULTS: LibrarySettings = {
  fromYear: 2022,
  toYear: 2026,
  lastSession: { year: 2026, session: "s" },
  essentialVariants: ESSENTIAL_DEFAULTS,
};

export function checkVariants(v: unknown): EssentialVariants | null {
  if (v === undefined) return ESSENTIAL_DEFAULTS;
  if (!v || typeof v !== "object") return null;
  const out: Partial<EssentialVariants> = {};
  for (const s of ["m", "s", "w"] as const) {
    const list = (v as Record<string, unknown>)[s];
    if (!Array.isArray(list) || list.length > 9) return null;
    const nums = [...new Set(list)].filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 9);
    if (nums.length !== list.length) return null;
    out[s] = nums.sort();
  }
  return out as EssentialVariants;
}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_SPAN = 15;

export function checkLibrarySettings(v: unknown): LibrarySettings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const last = o.lastSession as Record<string, unknown> | undefined;
  const from = o.fromYear;
  const to = o.toYear;
  const ly = last?.year;
  const ls = last?.session;
  const int = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= MIN_YEAR && x <= MAX_YEAR;
  if (!int(from) || !int(to) || !int(ly)) return null;
  if (from > to || to - from > MAX_SPAN) return null;
  if (ls !== "m" && ls !== "s" && ls !== "w") return null;
  if (ly < from || ly > to) return null;
  const essentialVariants = checkVariants(o.essentialVariants);
  if (!essentialVariants) return null;
  return { fromYear: from, toYear: to, lastSession: { year: ly, session: ls }, essentialVariants };
}

export async function getLibrarySettings(db: Db): Promise<LibrarySettings> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = 'library'`).bind().first<{ value: string }>();
  try {
    return checkLibrarySettings(row ? JSON.parse(row.value) : null) ?? LIBRARY_DEFAULTS;
  } catch {
    return LIBRARY_DEFAULTS;
  }
}

export async function saveLibrarySettings(db: Db, value: LibrarySettings, actorId: string, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('library', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3`,
    )
    .bind(JSON.stringify(value), actorId, now)
    .run();
  await audit(db, { actorId, action: "setting.library", entity: "setting", entityId: "library" }, now);
}

/** Years from newest to oldest, for forms and filters. */
export function libraryYears(s: LibrarySettings): number[] {
  return Array.from({ length: s.toYear - s.fromYear + 1 }, (_, i) => s.toYear - i);
}
