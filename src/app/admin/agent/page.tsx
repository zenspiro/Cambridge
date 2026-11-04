import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { closeStaleRuns, listRuns, type RunParams } from "@/lib/agent/runs";
import { describeRun, readReport, STATUS_LABELS, arr } from "@/lib/agent/labels";
import { dateFmt } from "@/lib/library/labels";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";

export const metadata: Metadata = { title: "Download agent" };

const MESSAGES = {
  bad: "Choose a subject, at least one year and one session.",
  running: "A run is already waiting or running. Open it below to follow it or cancel it.",
  missing: "That run no longer exists.",
  busy: "Too many runs this hour. Please wait a little.",
};

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string; code?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  await closeStaleRuns(env.DB);
  const runs = await listRuns(env.DB, 20);
  const subjects = await listSubjects(env.DB);
  const chosen = subjects.some((s) => s.code === q.code) ? q.code : "";
  const quals = [...new Set(subjects.map((s) => s.qualification))];

  return (
    <AdminShell current="/admin/agent" title="Download agent">
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <p className="muted">
        The agent reads the start pages of switched-on <Link className="link" href="/admin/sources">sources</Link>, follows
        their PDF links, and stores only files that are missing. Start with a dry run to see what it would fetch.
      </p>

      <form className="card stack" method="post" action="/admin/agent/start">
        <div className="field stack">
          <label className="label-inline" htmlFor="run-code">Subject</label>
          <select className="input" id="run-code" name="code" required defaultValue={chosen}>
            <option value="" disabled>Choose a subject</option>
            {quals.map((ql) => (
              <optgroup label={ql} key={ql}>
                {subjects.filter((s) => s.qualification === ql).map((s) => (
                  <option value={s.code} key={s.code}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="muted">The agent reads only this subject&apos;s start pages and Google Drive folders.</p>
        </div>
        <fieldset className="fieldset">
          <legend className="label-inline">Years</legend>
          <div className="checks">
            {libraryYears(lib).map((y) => (
              <label className="check" key={y}>
                <input type="checkbox" name="years" value={y} /> {y}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="label-inline">Sessions</legend>
          <div className="checks">
            {(["m", "s", "w", "y"] as const).map((s) => (
              <label className="check" key={s}>
                <input type="checkbox" name="sessions" value={s} /> {SESSION_LABELS[s]}
              </label>
            ))}
          </div>
          <p className="muted">Specimen covers specimen papers and syllabus documents, by the syllabus start year.</p>
        </fieldset>
        <fieldset className="fieldset">
          <legend className="label-inline">Mode</legend>
          <div className="checks">
            <label className="check"><input type="radio" name="mode" value="dry" defaultChecked /> Dry run (list only)</label>
            <label className="check"><input type="radio" name="mode" value="download" /> Download missing files</label>
            <label className="check"><input type="radio" name="mode" value="check" /> Check library (read the first page of stored files)</label>
          </div>
        </fieldset>
        <button className="btn btn-primary btn-block" type="submit">Run agent</button>
      </form>

      <section className="card stack">
        <div className="row-between">
          <h2 className="subtitle">Runs</h2>
          <Link className="btn btn-small" href="/admin/agent">Refresh</Link>
        </div>
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <ul className="list">
            {runs.map((r) => {
              const p = JSON.parse(r.params) as RunParams;
              const rep = readReport(r.result);
              const n = p.mode === "dry" ? `${arr(rep.candidates).length} to fetch` : p.mode === "check" ? `${rep.check?.items?.length ?? 0} to look at` : `${arr(rep.stored).length} stored`;
              return (
                <li className="list-row" key={r.id}>
                  <span className="doc-main">
                    <Link className="link" href={`/admin/agent/runs/${encodeURIComponent(r.id)}`}>{subjectLabel(subjects, p.code)}: {describeRun(p)}</Link>
                    <span className="muted">{dateFmt.format(r.created_at)}</span>
                  </span>
                  <span className="actions">
                    {r.status === "succeeded" ? <span className="muted">{n}</span> : null}
                    {r.status === "running" ? <span className="muted">{r.progress}%</span> : null}
                    <span className={r.status === "succeeded" ? "pill pill-ok" : r.status === "failed" ? "pill pill-gap" : "pill"}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
