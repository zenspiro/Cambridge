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
  pm: "Pre-release material",
  qr: "Listening transcript",
  tn: "Teachers' notes",
  er: "Examiner report",
  gt: "Grade thresholds",
  sp: "Specimen paper",
  sm: "Specimen mark scheme",
  sy: "Syllabus",
  su: "Syllabus update",
  gd: "Grade descriptions",
};

/** Other Cambridge codes seen in collections, stored as they are (no checklist asks for them). */
export const OTHER_TYPE_LABELS: Readonly<Record<string, string>> = {
  sf: "Source files",
  ir: "Instructions",
  ab: "Answer booklet",
};

/** A type in words; a code nobody has named yet reads "Cambridge file (xx)". */
export const docTypeLabel = (t: string): string => DOC_TYPE_LABELS[t] ?? OTHER_TYPE_LABELS[t] ?? `Cambridge file (${t})`;

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

/** Student themes (owner decision 5 Nov 2026): one layout, three looks, the same words in all. */
export const THEMES = [
  { id: "a", label: "Bold" },
  { id: "b", label: "Playful" },
  { id: "c", label: "Clean" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
/** Parent screens stay calm whatever theme the child picked (owner decision 5 Nov 2026). */
export const PARENT_THEME: ThemeId = "c";

/** Brand settings limits. The values themselves live in the database (setting 'brand', /admin/brand). */
export const BRAND = {
  maxNameLength: 60,
  maxShortNameLength: 20,
  maxDescriptionLength: 200,
  maxFooterLength: 400,
  maxImageBytes: 1024 * 1024,
  /** Brand saves and uploads per admin per hour share LIBRARY.writesPerHour (adminPost). */
  imageKinds: {
    logo: { label: "Logo", hint: "Wide logo for page headers, about 600 by 160 pixels." },
    square: { label: "Square logo", hint: "Square icon for phone home screens and small headers, 512 by 512 pixels." },
    favicon: { label: "Favicon", hint: "Browser tab icon, 64 by 64 pixels (PNG works best)." },
  },
} as const;
export type BrandImageKind = keyof typeof BRAND.imageKinds;
