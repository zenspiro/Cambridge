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
  /** Folder upload: files sent one at a time, and AI questions, per admin per hour. */
  folderFilesPerHour: 1500,
  folderAiPerHour: 80,
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
  su: "Syllabus update",
  gd: "Grade descriptions",
};

export const AGENT = {
  /** Most files one download run may store. */
  maxFilesPerRun: 400,
  /** Wait between requests to a source website. */
  delayMs: 5_000,
  /** A run with no sign of life for this long is closed, so a new one may start. */
  staleAfterMs: 15 * 60_000,
  /** A run GitHub has not started after this long gets a warning on its page. */
  slowStartMs: 5 * 60_000,
  /** The run page reloads itself this often while a run is active. */
  refreshSeconds: 10,
  /** Events kept per run for the activity log (one per file plus a few, for a full run). */
  maxEvents: 120,
  /** Agent runs an admin may start per hour. */
  runsPerHour: 10,
  /** Largest run report stored (bytes of JSON). */
  maxReportBytes: 400_000,
  /** Honest name sent to websites and matched in robots.txt. */
  userAgentToken: "ExamPrepLibraryAgent",
  /** Google Drive: pause between API calls, and how far one run may walk. */
  driveDelayMs: 1_000,
  driveMaxFolders: 2_000,
  driveMaxDepth: 8,
  /** Unclear Drive files whose first page one download run may read (each is a download). */
  coverReadsPerRun: 60,
  /** Workers AI: calls one run may make, files or folders per call, and the reply size. */
  aiCallsPerRun: 80,
  aiBatch: 40,
  aiMaxTokens: 2_500,
} as const;

/**
 * Workers AI usage estimate for the meter. Cloudflare bills in neurons; rates per million tokens
 * for the 70B Llama 3.1 model as listed in Cloudflare's pricing table (checked 4 Nov 2026), and the
 * free allowance per day (resets at 00:00 UTC). An estimate: Cloudflare's dashboard is exact.
 */
export const AI_USAGE = {
  freeNeuronsPerDay: 10_000,
  neuronsPerMillionInput: 26_668,
  neuronsPerMillionOutput: 204_805,
} as const;
