import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { BRAIN } from "@/lib/config";
import { aiModels, lastCheck, STATUS_WORDS, type ModelStatus } from "@/lib/brain/aiSetup";
import { isActive, lastCheckRun } from "@/lib/brain/runs";
import { reasonWords } from "@/lib/brain/labels";
import { dateFmt } from "@/lib/library/labels";

export const metadata: Metadata = { title: "AI setup" };

const MESSAGES = {
  ok_started: "Started. The check runs on GitHub with your keys and takes a minute or two. The page updates by itself.",
  ok_model: "Saved. Topic trees and paper reading use this Gemini model from now on.",
  bad_model: "Only a model the last check found working can be chosen. Run the check again.",
  running: "A brain run is already going. Wait for it to finish.",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
};

const pill = (s: ModelStatus) => (s === "ok" ? "pill pill-ok" : s === "untested" ? "pill" : s === "busy" ? "pill pill-gap" : "pill pill-none");

// AI setup (owner, 6 Nov 2026): which models the subject brain uses, and a check that runs on GitHub (where the keys
// are) to list the Gemini models the key can use and try them. A working Gemini model can be chosen here.
export default async function AiSetupPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const [models, check, run] = await Promise.all([aiModels(env.DB, env), lastCheck(env.DB), lastCheckRun(env.DB)]);
  const active = isActive(run);
  const working = check?.models.filter((m) => m.status === "ok") ?? [];
  return (
    <AdminShell current="/admin/ai" title="AI setup">
      {active ? <meta httpEquiv="refresh" content={String(BRAIN.refreshSeconds)} /> : null}
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <section className="card stack" id="in-use">
        <h2 className="subtitle">Models in use</h2>
        <dl className="facts">
          <dt>Main AI</dt><dd>Claude: <span className="mono">{models.claude || "not set"}</span> (set in wrangler.jsonc)</dd>
          <dt>Checking AI</dt><dd>Gemini: <span className="mono">{models.gemini || "not set"}</span> {models.geminiChosen ? "(chosen here)" : "(the default in wrangler.jsonc)"}</dd>
        </dl>
        <ActionForm className="inline-form" action="/admin/ai/check" messages={MESSAGES}>
          <button className="btn btn-primary" type="submit" disabled={active}>Check AI setup</button>
        </ActionForm>
        <p className="muted">
          The check runs on GitHub with your keys. It asks Google which Gemini models your key can use, sends one tiny question to the one in use and up
          to {BRAIN.checkModels} others, and tries Claude once. A model your free plan does not include says so. It costs a fraction of a cent.
        </p>
        {run && active ? <p className="notice" role="status">{run.status === "queued" ? "Waiting for GitHub to start the check" : run.step ?? "Checking"}. This page refreshes every {BRAIN.refreshSeconds} seconds.</p> : null}
        {run && run.status === "failed" ? <p className="alert" role="alert">The last check stopped: {reasonWords(run.errorRef)}</p> : null}
      </section>
      {check ? (
        <section className="card stack" id="check">
          <h2 className="subtitle">Last check, {dateFmt.format(check.at)}</h2>
          <ul className="list-plain">
            <li>Claude ({check.claude.model}): <span className={pill(check.claude.status)}>{STATUS_WORDS[check.claude.status]}</span> {check.claude.detail ? <span className="muted">{check.claude.detail}</span> : null}</li>
            <li>Gemini in use ({check.gemini.model}): <span className={pill(check.gemini.status)}>{STATUS_WORDS[check.gemini.status]}</span></li>
          </ul>
          <h3 className="label-inline">Gemini models your key can use ({check.models.length}), {working.length} working</h3>
          <table className="info-table">
            <thead><tr><th scope="col">Model</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Choose</span></th></tr></thead>
            <tbody>
              {check.models.map((m) => (
                <tr key={m.name} id={`model-${m.name}`}>
                  <td>{m.label} <span className="mono muted">{m.name}</span></td>
                  <td><span className={pill(m.status)}>{STATUS_WORDS[m.status]}</span>{m.detail && m.status !== "ok" ? <details className="model-detail"><summary className="link">Google&apos;s words</summary><span className="muted">{m.detail}</span></details> : null}</td>
                  <td>
                    {m.status === "ok" && m.name !== models.gemini ? (
                      <ActionForm action="/admin/ai/model" messages={MESSAGES}>
                        <input type="hidden" name="model" value={m.name} />
                        <button className="btn btn-small" type="submit">Use this model</button>
                      </ActionForm>
                    ) : m.name === models.gemini ? <span className="muted">In use</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="card"><p className="muted">No check has run yet. Press Check AI setup.</p></section>
      )}
    </AdminShell>
  );
}
