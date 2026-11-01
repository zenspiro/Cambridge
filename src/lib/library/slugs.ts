// Readable addresses for sessions: /admin/library/0625/2024/june.
export const SESSION_SLUGS = { m: "march", s: "june", w: "november" } as const;
export type ExamSession = keyof typeof SESSION_SLUGS;

export function sessionFromSlug(slug: string): ExamSession | null {
  const hit = (Object.entries(SESSION_SLUGS) as [ExamSession, string][]).find(([, v]) => v === slug);
  return hit ? hit[0] : null;
}

export const sessionHref = (code: string, year: number, s: ExamSession) => `/admin/library/${code}/${year}/${SESSION_SLUGS[s]}`;
export const versionHref = (code: string, from: number) => `/admin/library/${code}/version/${from}`;
