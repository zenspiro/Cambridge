// App settings in one place (brief 15.3). No imports, so Node tests can load it.

export const AUTH = {
  /** The only admin for now. Personal accounts can replace this later. */
  platformAdminId: "platform-admin",
  sessionHours: 12,
  /** Sign-in tries per network inside one window, counted before the password check. */
  maxAttempts: 5,
  windowMinutes: 15,
  /** ADMIN_PASS shorter than this disables sign-in (and is logged). */
  minPasswordLength: 12,
  maxPasswordLength: 200,
  /** __Host- prefix: Secure, Path=/ and no Domain are enforced by the browser. */
  cookieName: "__Host-admin",
} as const;

// Library years and the latest public session live in the database (setting 'library',
// src/lib/settings.ts), changed at /admin/settings. Limits stay here.
export const LIBRARY = {
  maxFilesPerUpload: 20,
  maxFileBytes: 25 * 1024 * 1024,
  maxUploadBytes: 90 * 1024 * 1024,
  /** Upload batches per admin per hour. */
  uploadsPerHour: 30,
  /** Other admin writes (sources) per admin per hour. */
  writesPerHour: 120,
  /** Rows shown on one library page. */
  pageSize: 300,
} as const;

export const SESSION_LABELS: Readonly<Record<string, string>> = {
  m: "March",
  s: "June",
  w: "November",
  y: "Specimen",
};

export const DOC_TYPE_LABELS: Readonly<Record<string, string>> = {
  qp: "Question paper",
  ms: "Mark scheme",
  in: "Insert",
  ci: "Confidential instructions",
  er: "Examiner report",
  gt: "Grade thresholds",
  sp: "Specimen paper",
  sm: "Specimen mark scheme",
  sy: "Syllabus",
};

export const AGENT = {
  /** Most files one download run may store. */
  maxFilesPerRun: 400,
  /** Wait between requests to a source website. */
  delayMs: 5_000,
  /** A queued or running run older than this is treated as dead and a new one may start. */
  staleAfterMs: 3 * 3_600_000,
  /** Agent runs an admin may start per hour. */
  runsPerHour: 10,
  /** Largest run report stored (bytes of JSON). */
  maxReportBytes: 400_000,
  /** Honest name sent to websites and matched in robots.txt. */
  userAgentToken: "ExamPrepLibraryAgent",
} as const;
