import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { closeStaleRuns, getRun, type RunParams } from "@/lib/agent/runs";
import { arr, describeRun, elapsed, readEvents, readReport, reasonText, STATUS_LABELS } from "@/lib/agent/labels";
import { GroupPill } from "@/components/LibraryBits";
import { loadSyllabus } from "@/lib/library/catalog";
import { describeFile, loadPapers, paperLookup, versionForFile } from "@/lib/library/papers";
import { countTypes, groupFiles } from "@/lib/library/summary";
import { formatBytes } from "@/lib/library/labels";
import { sessionHref, versionHref } from "@/lib/library/slugs";
import { AGENT } from "@/lib/config";
import { dateFmt, REASON_LABELS, timeFmt } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Agent run" };

const ERRORS: Record<string, string> = {
  not_set_up: "The agent is not set up yet: the GITHUB_TOKEN secret is missing in Cloudflare.",
  github_401: "GitHub refused the token (401). Check the GITHUB_TOKEN secret.",
  github_403: "GitHub refused the token (403). It needs Actions: read and write on this repository.",
  github_404: "GitHub could not find the agent workflow (404). Check the token's repository access.",
  github_422: "GitHub refused the run (422). The agent workflow may not be on the main branch yet.",
  github_unreachable: "GitHub could not be reached. Please try again.",
  timeout: "The agent went quiet for 15 minutes, so the run was closed. The GitHub log shows what happened.",
  never_started:
    "GitHub never started the agent, or it stopped before it could report. Most often the AGENT_SECRET repository secret in GitHub (Settings, Secrets and variables, Actions) is missing or differs from Cloudflare's.",
  cancelled: "You cancelled this run.",
  agent: "The agent stopped with an error. See the details below.",
};

type Describe = (fileName: string) => string;

/** Files grouped by session, each described in words, the file name underneath. */
function FileList({ title, files, describe, note }: { title: string; files: { name: string; note?: string }[]; describe: Describe; note?: string }) {
  if (files.length === 0) return null;
  const byName = new Map(files.map((f) => [f.name, f.note]));
  const groups = groupFiles(files.map((f) => f.name));
  return (
    <section className="card stack">
      <details>
        <summary className="subtitle summary">{title} ({files.length})</summary>
        {note ? <p className="muted">{note}</p> : null}
        {groups.map((g) => (
          <div className="stack-tight file-group" key={g.key}>
            <h3 className="label-inline">{g.label}: {countTypes(g.files)}</h3>
            <ul className="list">
              {g.files.map((f) => (
                <li className="list-row" key={f.fileName}>
                  <span className="doc-main">
                    <span>{describe(f.fileName)}</span>
                    <span className="mono muted">{f.fileName}{byName.get(f.fileName) ? ` · ${byName.get(f.fileName)}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}

/** Plain lists (links and pages): no file names to describe. */
function List({ title, items, note }: { title: string; items: string[]; note?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="card stack">
      <details>
        <summary className="subtitle summary">{title} ({items.length})</summary>
        {note ? <p className="muted">{note}</p> : null}
        <ul className="list">
          {items.map((t, i) => <li className="list-row" key={i}>{t}</li>)}
        </ul>
      </details>
    </section>
  );
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cancel?: string; ref?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const q = await searchParams;
  const env = await getEnv();
  const now = Date.now();
  await closeStaleRuns(env.DB, now);
  const run = await getRun(env.DB, id);
  if (!run) notFound();
  const p = JSON.parse(run.params) as RunParams;
  const rep = readReport(run.result);
  const [checklist, { papers }] = await Promise.all([loadSyllabus(env.DB, p.code), loadPapers(env.DB, p.code)]);
  const versions = checklist?.versions.map((g) => g.version) ?? [];
  const look = paperLookup(papers);
  const describe: Describe = (name) => describeFile(name, versionForFile(versions, name), look);
  const touched = groupFiles(p.mode === "dry" ? arr(rep.candidates).map((c) => c.name) : arr(rep.stored));
  const cellsByName = new Map(
    (checklist ? [...checklist.versions.flatMap((g) => [...g.docs, ...g.specimens.flatMap((r) => Object.values(r.cells))]),
      ...checklist.sessions.flatMap((g) => [...g.docs, ...g.rows.flatMap((r) => Object.values(r.cells))])] : [])
      .filter(Boolean).map((c) => [c!.fileName, c!]),
  );
  const wouldEssential = p.mode === "dry" ? arr(rep.candidates).filter((c) => cellsByName.get(c.name)?.essential).length : 0;
  const candidates = arr(rep.candidates);
  const done = !["queued", "running"].includes(run.status);
  const events = readEvents(run.events).reverse();
  const slowStart = run.status === "queued" && now - run.created_at > AGENT.slowStartMs;
  const actionsUrl = env.GITHUB_REPO && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO)
    ? `https://github.com/${env.GITHUB_REPO}/actions/workflows/${env.AGENT_WORKFLOW ?? "agent.yml"}`
    : null;
  const logUrl = run.run_url && /^https:\/\/github\.com\//.test(run.run_url) ? run.run_url : actionsUrl;

  return (
    <AdminShell current="/admin/agent" title="Agent run">
      {/* Reloads the page while the run is active, so progress shows without clicking. No script needed. */}
      {!done ? <meta httpEquiv="refresh" content={String(AGENT.refreshSeconds)} /> : null}
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
          <div className="stack-tight" aria-live="polite">
            <div className="row-between">
              <span>{run.status === "queued" ? "Waiting for GitHub to start the agent" : (run.step ?? "Working")}</span>
              <span className="muted">{run.status === "running" ? `${run.progress}%` : ""}</span>
            </div>
            <progress className="bar" max={100} value={run.status === "running" ? run.progress : undefined}>
              {run.progress}%
            </progress>
            <p className="muted">
              {elapsed(now - (run.started_at ?? run.created_at))} so far
              {run.heartbeat_at ? `, last update ${elapsed(now - run.heartbeat_at)} ago` : ""}. This page refreshes every{" "}
              {AGENT.refreshSeconds} seconds. The agent waits 5 seconds between requests to be polite to the website.
            </p>
            {slowStart ? (
              <p className="alert" role="alert">
                GitHub has not started the agent after {elapsed(now - run.created_at)}. Check the GitHub log. If it shows
                &quot;AGENT_SECRET ... required&quot;, the repository secret is missing. You can cancel this run.
              </p>
            ) : null}
            <div className="actions">
              {logUrl ? <a className="btn btn-small" href={logUrl} rel="noopener noreferrer" target="_blank">GitHub log</a> : null}
              {q.cancel === "1" ? (
                <span className="confirm">
                  <span>Cancel this run?</span>
                  <form method="post" action="/admin/agent/cancel">
                    <input type="hidden" name="id" value={run.id} />
                    <button className="btn btn-small btn-danger" type="submit">Yes, cancel</button>
                  </form>
                  <Link className="btn btn-small" href={`/admin/agent/runs/${encodeURIComponent(run.id)}`}>Never mind</Link>
                </span>
              ) : (
                <Link className="btn btn-small" href={`/admin/agent/runs/${encodeURIComponent(run.id)}?cancel=1`}>Cancel run</Link>
              )}
            </div>
          </div>
        ) : null}
        {done && logUrl ? (
          <p className="muted">
            <a className="link" href={logUrl} rel="noopener noreferrer" target="_blank">GitHub log for this run</a>
          </p>
        ) : null}
        {done && run.status === "succeeded" ? (
          <ul className="stats">
            <li><strong>{rep.pagesVisited ?? 0}</strong> {rep.pagesVisited === 1 ? "page" : "pages"} read</li>
            <li><strong>{rep.linksFound ?? 0}</strong> PDF {rep.linksFound === 1 ? "link" : "links"}</li>
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

      {done && run.status === "succeeded" && checklist && touched.length > 0 ? (
        <section className="card stack">
          <h2 className="subtitle">{p.mode === "dry" ? "What a download would add" : "Library after this run"}</h2>
          {p.mode === "dry" ? (
            <p className="muted">
              {wouldEssential} of these {arr(rep.candidates).length} files are essential (variant {checklist.sessions[0] ? [...new Set(checklist.sessions[0].rows.filter((r) => r.essential).map((r) => r.variant))].join(", ") : "2"}); the rest are extras.
            </p>
          ) : null}
          <ul className="list">
            {touched.map((g) => {
              const sess = g.session === "y" ? null : checklist.sessions.find((x) => x.year === g.year && x.session === g.session);
              const ver = g.session === "y" ? checklist.versions.find((x) => x.version.valid_from_year === g.year) : null;
              const status = sess?.status ?? ver?.status;
              const href = sess ? sessionHref(p.code, sess.year, sess.session) : ver ? versionHref(p.code, ver.version.valid_from_year) : null;
              return (
                <li className="list-row" key={g.key}>
                  <span className="doc-main">
                    {href ? <Link className="link" href={href}>{g.label}</Link> : <span>{g.label}</span>}
                    <span className="muted">
                      {p.mode === "dry" ? "Would add" : "Added"}: {countTypes(g.files)}.{" "}
                      {(() => {
                        const ess = g.files.filter((f) => cellsByName.get(f.fileName)?.essential).length;
                        const extra = g.files.length - ess;
                        return ess === g.files.length ? "All essential." : ess === 0 ? `All extras${extra ? " (other variants or optional files)" : ""}.` : `${ess} essential, ${extra} ${extra === 1 ? "extra" : "extras"}.`;
                      })()}
                    </span>
                  </span>
                  {status ? <GroupPill status={status} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="card stack">
          <h2 className="subtitle">Activity</h2>
          <ol className="list">
            {events.map((e, i) => (
              <li className="list-row event-row" key={i}>
                {e.file ? (
                  <span className="doc-main">
                    <span>
                      <span className={e.outcome === "failed" ? "event-bad" : "event-good"}>{e.outcome === "failed" ? "Not stored" : "Stored"}:</span>{" "}
                      {describe(e.file)}
                      {e.bytes ? ` (${formatBytes(e.bytes)})` : ""}
                      {e.outcome === "failed" && e.reason ? `. ${reasonText(e.reason)}` : ""}
                    </span>
                    <span className="mono muted">{e.text.split(":")[0]} · {e.file}</span>
                  </span>
                ) : (
                  <span>{e.text}</span>
                )}
                <time className="muted" dateTime={new Date(e.at).toISOString()}>{timeFmt.format(e.at)}</time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {arr(rep.driveFolders).length > 0 ? (
        <section className="card stack">
          <h2 className="subtitle">Google Drive folders read</h2>
          <ul className="list">
            {arr(rep.driveFolders).map((f) => (
              <li className="list-row" key={f.folderId}>
                <span className="doc-main">
                  <span><strong>{f.name}</strong>{f.looksLike ? <span className="muted"> · looks like {f.looksLike}</span> : null}</span>
                  {f.error ? (
                    <span className="event-bad">Could not be read: {f.error}</span>
                  ) : (
                    <span className="muted">
                      {f.pdfs} PDFs in {f.folders} folders{f.years ? `, ${f.years[0]} to ${f.years[1]}` : ""}{f.truncated ? " (stopped at the folder limit)" : ""}.
                      {" "}{f.forThisSyllabus} recognised for {p.code}
                      {Object.keys(f.otherSubjects ?? {}).length ? `; other subjects: ${Object.entries(f.otherSubjects).map(([c, n]) => `${c} (${n})`).join(", ")}` : ""}.
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FileList title={p.mode === "dry" ? "Would download" : "Found"} files={candidates.map((c) => ({ name: c.name, note: c.why && c.why !== "Cambridge file name" ? `worked out: ${c.why}` : undefined }))} describe={describe}
        note={p.mode === "dry" ? "Nothing has been downloaded yet. Press the button above to fetch these." : undefined} />
      <FileList title="Stored" files={arr(rep.stored).map((name) => ({ name }))} describe={describe} />
      <FileList title="Not stored" files={arr(rep.failed).map((f) => ({ name: f.name, note: reasonText(f.reason) }))} describe={describe} />
      <List title="Links not recognised" items={arr(rep.unmatched)}
        note="PDFs whose names do not match a Cambridge paper, specimen or syllabus document. Nothing was fetched. If one is needed, add it by hand from the library." />
      <List title="Blocked by robots.txt" items={arr(rep.robotsBlocked)} note="The website asks automated visitors not to fetch these, so the agent skipped them." />
      <List title="Pages and folders that could not be read" items={arr(rep.pageErrors).map((e) => `${e.url}: ${e.status}`)} />
    </AdminShell>
  );
}
