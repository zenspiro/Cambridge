// Which version is live (review, 10 Nov 2026): the commit and deploy time CI writes into the Worker's vars.
// No Next imports.

export type BuildInfo = { commit: string; short: string; at: number | null };

/** The live build from the vars, or null for a local or test build (no commit recorded). Pure. */
export function buildInfo(env: { BUILD_COMMIT?: string; BUILD_AT?: string }): BuildInfo | null {
  const commit = env.BUILD_COMMIT ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  const at = Date.parse(env.BUILD_AT ?? "");
  return { commit, short: commit.slice(0, 7), at: Number.isFinite(at) ? at : null };
}
