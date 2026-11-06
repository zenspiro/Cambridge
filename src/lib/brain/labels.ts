// Plain words for topic tree runs and checks (admin pages). No Next imports.

/** Why a run stopped, by its reason code. */
export const BRAIN_REASONS: Record<string, string> = {
  never_started: "GitHub never started the run. Check that the Brain workflow exists on the main branch and that AGENT_SECRET is set in GitHub.",
  timeout: "The run went quiet for 30 minutes and was closed.",
  not_set_up: "Starting runs is not set up (GITHUB_TOKEN or the workflow name is missing).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
  no_syllabus: "The syllabus PDF for this version is not in the library.",
  pdf_too_big: "The syllabus PDF is larger than the AIs accept.",
  claude_key: "Claude refused the key. Check the GitHub secret CLAUDE_API_KEY.",
  claude_model: "Claude does not know the model set in CLAUDE_MODEL.",
  claude_refused: "Claude declined to read this syllabus.",
  claude_too_long: "Claude's answer was longer than allowed.",
  claude_bad_answer: "Claude's answer was not in the agreed shape.",
  claude_error: "Claude's service gave an error. Try again later.",
  gemini_key: "Gemini refused the key. Check the GitHub secret GEMINI_API_KEY.",
  gemini_model: "Gemini does not know the model set in GEMINI_MODEL. The GitHub log lists the models it offers.",
  gemini_too_long: "Gemini's answer was longer than allowed.",
  gemini_bad_answer: "Gemini's answer was not in the agreed shape.",
  gemini_error: "Gemini's service gave an error. Try again later.",
  models: "CLAUDE_MODEL or GEMINI_MODEL is not set.",
  script_error: "The run stopped on an unexpected error. The GitHub log has the details.",
};

export const reasonWords = (code: string | null) =>
  (code && BRAIN_REASONS[code]) || (code?.startsWith("github_") ? BRAIN_REASONS.github! : code?.startsWith("save_") ? "The tree could not be saved." : BRAIN_REASONS.script_error!);

export const TIER_WORDS = { core: "Core", supplement: "Supplement", all: "All candidates" } as const;

export const PROBLEM_WORDS = {
  words: "Not found in the syllabus text",
  numbers: "Numbering",
  missing: "Missing from the tree",
  shape: "Answer shape",
} as const;
