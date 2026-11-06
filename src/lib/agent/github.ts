// Starts the agent (or brain) workflow on GitHub Actions (workflow_dispatch). The token needs only
// "Actions: read and write" on this one repository.
import type { AppEnv } from "../env.ts";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FILE_RE = /^[A-Za-z0-9_.-]+\.ya?ml$/;
const REF_RE = /^[A-Za-z0-9_./-]+$/;

export type DispatchResult = { ok: true } | { ok: false; reason: "not_set_up" | "refused"; status?: number };

export const dispatchAgent = (env: AppEnv, jobId: string) => dispatchWorkflow(env, env.AGENT_WORKFLOW, jobId);

/** The subject brain's runs (topic tree) use their own workflow, which holds the AI keys. */
export const dispatchBrain = (env: AppEnv, jobId: string) => dispatchWorkflow(env, env.BRAIN_WORKFLOW, jobId);

async function dispatchWorkflow(env: AppEnv, workflow: string | undefined, jobId: string): Promise<DispatchResult> {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO;
  const ref = env.AGENT_REF;
  if (!token || !repo || !workflow || !ref || !REPO_RE.test(repo) || !FILE_RE.test(workflow) || !REF_RE.test(ref)) {
    return { ok: false, reason: "not_set_up" };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "exam-prep-admin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref, inputs: { job_id: jobId } }),
  });
  return res.status === 204 ? { ok: true } : { ok: false, reason: "refused", status: res.status };
}
