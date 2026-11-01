import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { getRun, type RunParams } from "@/lib/agent/runs";
import { arr, describeRun, readReport, STATUS_LABELS } from "@/lib/agent/labels";
import { dateFmt, REASON_LABELS } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Agent run" };

const ERRORS: Record<string, string> = {
  not_set_up: "The agent is not set up yet: the GITHUB_TOKEN secret is missing in Cloudflare.",
  github_401: "GitHub refused the token (401). Check the GITHUB_TOKEN secret.",
  github_403: "GitHub refused the token (403). It needs Actions: read and write on this repository.",
  github_404: "GitHub could not find the agent workflow (404). Check the token's repository access.",
  github_422: "GitHub refused the run (422). The agent workflow may not be on the main branch yet.",
  github_unreachable: "GitHub could not be reached. Please try again.",
  timeout: "The run did not report back within 3 hours and was closed.",
  agent: "The agent stopped with an error. See the details below.",
};

function List({ title, items, mono = true }: { title: string; items: string[]; mono?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="card stack">
      <details>
        <summary className="subtitle summary">{title} ({items.length})</summary>
        <ul className="list">
          {items.map((t, i) => <li className={mono ? "list-row mono" : "list-row"} key={i}>{t}</li>)}
        </ul>
      </details>
    </section>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const env = await getEnv();
  const run = await getRun(env.DB, id);
  if (!run) notFound();
  const p = JSON.parse(run.params) as RunParams;
  const rep = readReport(run.result);
  const candidates = arr(rep.candidates);
  const done = run.status === "succeeded" || run.status === "failed";

  return (
    <AdminShell current="/admin/agent" title="Agent run">
      <section className="card stack">
        <div className="row-between">
          <h2 className="subtitle">{describeRun(p)}</h2>
          <span className={run.status === "succeeded" ? "pill pill-ok" : run.status === "failed" ? "pill pill-gap" : "pill"}>
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
        </div>
        <p className="muted">
          Started {dateFmt.format(run.created_at)}
          {run.finished_at ? `, finished ${dateFmt.format(run.finished_at)}` : ""}.
        </p>
        {run.error_ref && ERRORS[run.error_ref] ? <p className="alert" role="alert">{ERRORS[run.error_ref]}</p> : null}
        {typeof rep.error === "string" && run.error_ref === "agent" ? <p className="mono">{rep.error.slice(0, 300)}</p> : null}
        {!done ? (
          <p className="muted">
            The agent waits 5 seconds between requests, so a run can take a while.{" "}
            <Link className="link" href={`/admin/agent/runs/${encodeURIComponent(run.id)}`}>Refresh</Link> to see progress.
          </p>
        ) : null}
        {done && run.status === "succeeded" ? (
          <ul className="stats">
            <li><strong>{rep.pagesVisited ?? 0}</strong> pages read</li>
            <li><strong>{rep.linksFound ?? 0}</strong> PDF links</li>
            <li><strong>{p.mode === "dry" ? candidates.length : arr(rep.stored).length}</strong> {p.mode === "dry" ? "to fetch" : "stored"}</li>
            <li><strong>{rep.skippedHave ?? 0}</strong> already stored</li>
            <li><strong>{rep.skippedNotRequested ?? 0}</strong> outside this run</li>
          </ul>
        ) : null}
        {done && p.mode === "dry" && run.status === "succeeded" && candidates.length > 0 ? (
          <form method="post" action="/admin/agent/start">
            <input type="hidden" name="code" value={p.code} />
            {p.years.map((y) => <input key={y} type="hidden" name="years" value={y} />)}
            {p.sessions.map((s) => <input key={s} type="hidden" name="sessions" value={s} />)}
            <input type="hidden" name="mode" value="download" />
            <button className="btn btn-primary" type="submit">Download these {candidates.length} files</button>
          </form>
        ) : null}
      </section>

      <List title={p.mode === "dry" ? "Would fetch" : "Found"} items={candidates.map((c) => c.name)} />
      <List title="Stored" items={arr(rep.stored)} />
      <List title="Not stored" items={arr(rep.failed).map((f) => `${f.name}: ${REASON_LABELS[f.reason as keyof typeof REASON_LABELS] ?? f.reason}`)} mono={false} />
      <List title="Links not recognised" items={arr(rep.unmatched)} />
      <List title="Blocked by robots.txt" items={arr(rep.robotsBlocked)} />
      <List title="Pages that failed" items={arr(rep.pageErrors).map((e) => `${e.url} (${e.status})`)} />
    </AdminShell>
  );
}
