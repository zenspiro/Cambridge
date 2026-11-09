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
  gemini_model: "Gemini does not know the model in use. Run the check on the AI setup page and pick a working model.",
  gemini_plan: "The Gemini model chosen is not on your key's plan (no free use of it). Pick a working model on the AI setup page.",
  gemini_busy: "Gemini's limit was reached and stayed reached after waiting. Try again later, or pick another model on the AI setup page.",
  gemini_too_long: "Gemini's answer was longer than allowed.",
  gemini_bad_answer: "Gemini's answer was not in the agreed shape.",
  gemini_error: "Gemini's service gave an error. Try again later.",
  gemini_down: "Google's Gemini service was overloaded or down, and still was after three more tries over about two minutes. Nothing was charged for Claude: it only starts after Gemini. Try again later.",
  models: "CLAUDE_MODEL or GEMINI_MODEL is not set.",
  no_paper: "The paper's PDF is not in the library.",
  no_reading: "There is no reading yet to draw the figures for. Read the paper first.",
  batch_cap: "Read all stopped before the next paper: it would go over your monthly cap. The papers read so far are saved. Raise the cap on AI setup or wait for next month, then press Read all again for the rest.",
  batch_price: "Read all stopped before the next paper: a model in use has no price, so the cap cannot be checked. Set its price on AI setup, then press Read all again for the rest.",
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

/**
 * A model's name in words from its id: "claude-haiku-5-5" is "Claude Haiku 5.5", "gemini-3.5-flash" is "Gemini 3.5
 * Flash". An id in another shape is shown as it is.
 */
export function modelName(id: string): string {
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (c) return `Claude ${c[1]![0]!.toUpperCase()}${c[1]!.slice(1)} ${c[2]}${c[3] ? `.${c[3]}` : ""}`;
  if (/^gemini-[a-z0-9.-]+$/.test(id)) return id.split("-").map((w) => (/^[a-z]/.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
  return id;
}
