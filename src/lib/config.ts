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
  m: "Mar",
  s: "Jun",
  w: "Nov",
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

/**
 * The subject brain (Phase 2). Step 1, the topic tree: Claude copies a syllabus's subject content into topics and
 * learning goals; code checks every word against the PDF's own text and the numbering; a second AI (Gemini) reads
 * the same PDF on its own and the two are compared. Models are Worker vars (CLAUDE_MODEL, GEMINI_MODEL), never here.
 */
/** Team access (owner, 9 Nov 2026). */
export const TEAM = {
  inviteDays: 7,
  /** A team member signs in again after this long, like the owner's admin session. */
  sessionMs: 12 * 3_600_000,
  invitesPerDay: 30,
  maxSubjects: 40,
} as const;

/** Storage on Home (owner, 9 Nov 2026): Cloudflare's free allowances, how long a count is kept, how far a bucket is listed. */
export const STORAGE = {
  dbFreeBytes: 5 * 1000 ** 3,
  filesFreeBytes: 10 * 1000 ** 3,
  cacheMs: 3_600_000,
  /** Bucket list calls per count (1,000 objects each); past it the count says "at least". */
  maxListCalls: 20,
} as const;

export const BRAIN = {
  /** A run with no sign of life for this long is closed (one Claude answer can take several minutes). */
  staleAfterMs: 30 * 60_000,
  /** Topic tree runs an admin may start per hour. */
  runsPerHour: 6,
  /** The tree page reloads itself this often while a run is active. */
  refreshSeconds: 15,
  /** Claude drafts at most this many times per run (the second try is given the problems found). */
  attempts: 2,
  /** Claude's answer limit (streamed), its effort, and Gemini's answer limit. */
  claudeMaxTokens: 96_000,
  claudeEffort: "high",
  geminiMaxTokens: 65_536,
  /** Size limits on a tree (both AIs' answers are cut to these before checking). */
  maxTopics: 600,
  maxGoals: 4_000,
  maxTitle: 200,
  maxGoalText: 1_500,
  maxNotes: 3_000,
  /** Largest syllabus PDF sent to the AIs, and largest stored tree plus report (bytes of JSON). */
  maxPdfBytes: 20 * 1024 * 1024,
  maxTreeBytes: 1_500_000,
  /** Word check: characters compared in runs of this length; a goal passes when this share of it is found. */
  gramLength: 10,
  minWordCover: 0.9,
  /** A syllabus text shorter than this means the PDF could not be read, so the word check cannot run. */
  minTextChars: 5_000,
  /** Two wordings count as the same when this similar (letters and digits only, pairs of characters). */
  sameText: 0.85,
  /** Share of goals both AIs must agree on (after the word check settles who copied right) for "ready". */
  minAgreement: 0.97,
  /** Problems and disagreements kept in a report. */
  maxReportItems: 150,
  /** AI setup check: Gemini models tried with one tiny question each (besides the one in use), and the pause between. */
  checkModels: 8,
  checkDelayMs: 1_500,
  /** Gemini busy (429): tries per question, and the longest wait between them. */
  geminiTries: 4,
  geminiMaxWaitMs: 60_000,
  /** Gemini overloaded or down (503, 500, 502, 504, no answer): the waits before each further try (owner, 7 Nov 2026). */
  geminiRetryWaitsMs: [10_000, 30_000, 60_000],
  /** Rough cost before a run with no history (owner request 6 Nov 2026): PDF bytes per page, tokens per page read, and
   * tokens one answer writes (thinking included). Past runs on the same model replace these. */
  estBytesPerPage: 25_000,
  estTokensPerPage: 2_500,
  estOutTokens: 30_000,
  /** Reading papers (step 2b, owner 7 Nov 2026): size limits on one paper's reading, the drawing of each figure, and the
   * least readable text for the word check to run. */
  maxPaperItems: 400,
  /** Thinking effort for reading a paper (copying, checked by code and Gemini) and for drawing figures (owner chose the
   * lower effort after the 7 Nov 2026 dry run). Topic trees keep `claudeEffort`. */
  paperEffort: "low",
  /** Read accuracy colours (owner, 7 Nov 2026): green from this % with no red flag, amber from scoreAmber, else red. */
  scoreGreen: 95,
  scoreAmber: 80,
  drawEffort: "medium",
  maxItemText: 4_000,
  maxOptions: 8,
  maxFigures: 60,
  /** Tables per part, rows per table, cells per row (owner, 9 Nov 2026: tables as data). */
  maxTables: 6,
  maxTableRows: 40,
  maxTableCols: 14,
  maxSvgBytes: 60_000,
  /** One figure page's drawing (figures.ts PageArt as JSON), from the script. */
  maxArtBytes: 3_000_000,
  maxPaperBytes: 2_000_000,
  /** Scores kept per paper, one per full reading (owner, 8 Nov 2026: compare models). */
  maxReadScores: 20,
  /** Read all (owner, 8 Nov 2026): papers one batch run reads at most, one after another, the cap checked before each. */
  maxBatchPapers: 24,
  /** The run queue (owner, 12 Nov 2026): asks waiting for the brain run going on; a Gemini hold is tried again after this. */
  maxQueue: 10,
  queueRetryMs: 30 * 60_000,
  /** Other Claude models offered in "Read with" besides the Reading AI (owner, 9 Nov 2026). */
  maxReaderChoices: 6,
  minPaperTextChars: 400,
  /** Brain run activity kept per run for the live progress panel. */
  maxRunEvents: 60,
} as const;

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
  maxEmailLength: 254,
  maxImageBytes: 1024 * 1024,
  /** Brand saves and uploads per admin per hour share LIBRARY.writesPerHour (adminPost). */
  imageKinds: {
    logo: { label: "Logo", hint: "Wide logo for page headers, about 600 by 160 pixels." },
    square: { label: "Square logo", hint: "Square icon for phone home screens and small headers, 512 by 512 pixels." },
    favicon: { label: "Favicon", hint: "Browser tab icon, 64 by 64 pixels (PNG works best)." },
  },
} as const;
export type BrandImageKind = keyof typeof BRAND.imageKinds;

/** Student and parent accounts (Phase 1 step 2). Secrets live in the Worker; these are limits only. */
export const ACCOUNT = {
  /** Roles a person can pick on the welcome page. Teachers come later (docs/PLAN.md). */
  roles: ["student", "parent"] as const,
  sessionDays: 30,
  /** A session in use is renewed at most once per this many hours. */
  renewHours: 24,
  codeLength: 6,
  codeMinutes: 10,
  codeTries: 5,
  /** Sign-in codes sent, per email address and per network, per hour. */
  codesPerEmailPerHour: 5,
  codesPerNetworkPerHour: 20,
  /** Code checks per email address and per network, per hour (on top of the tries per code). */
  checksPerEmailPerHour: 15,
  checksPerNetworkPerHour: 60,
  /** BETTER_AUTH_SECRET shorter than this switches student and parent sign-in off. */
  minSecretLength: 32,
  maxNameLength: 60,
  maxEmailLength: 254,
  cookiePrefix: "acct",
} as const;
export type AccountRole = (typeof ACCOUNT.roles)[number];

/** Parent approval and profiles (Phase 1 step 3). The age limits themselves are a database setting (admin Settings). */
export const CONSENT = {
  /** Used when the setting is missing. Owner decision 5 Nov 2026: a parent approves every student under 18. */
  defaultAge: 18,
  minAge: 10,
  maxAge: 21,
  linkDays: 7,
  sendsPerStudentPerDay: 3,
  sendsPerParentEmailPerDay: 5,
  /** Birth years offered: from this many years ago up to this many years ago. */
  oldestAge: 100,
  youngestAge: 8,
  /** Exam sessions a student can plan: this year and the next few. */
  examYearsAhead: 4,
  /** Countries shown first in pickers (launch markets). */
  topCountries: ["PK", "AE", "SA", "GB", "US"],
} as const;
/** Profile changes (names, theme, exam sessions) per person per hour. */
export const ACCOUNT_WRITES_PER_HOUR = 120;

/** Families (Phase 1 step 4, owner decisions 5 Nov 2026): one parent per family, no second guardian. */
export const FAMILY = {
  maxChildren: 8,
  codeDays: 7,
  /** Family codes use letters and digits that cannot be mixed up (no 0/O, 1/I/L). */
  codeLength: 8,
  joinTriesPerHour: 10,
  childAccountsPerDay: 5,
} as const;
