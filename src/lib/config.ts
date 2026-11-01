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

export const LIBRARY = {
  /** Owner decision: 2022 to 2026 (Physics 0625 first). */
  fromYear: 2022,
  toYear: 2026,
  /** The latest exam session whose papers can be public yet; later ones are not counted as gaps. */
  lastSession: { year: 2026, session: "s" as "m" | "s" | "w" },
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
