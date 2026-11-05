import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { LIST_SITES } from "@/lib/library/queries";
import { listSubjects } from "@/lib/library/catalog";
import { aliasLabel, loadAliases } from "@/lib/library/alias";
import { folderCode, pageKind, scanSummary } from "@/lib/library/sourcesView";

export const metadata: Metadata = { title: "Sources" };

const MESSAGES = {
  ok_added: "Source added.",
  ok_changed: "Source updated.",
  ok_removed: "Source removed.",
  name: "Give the source a name (up to 80 characters).",
  url: "Use a full https address, like https://www.example.org/papers/ (no IP addresses or logins).",
  notes: "Notes can be up to 300 characters.",
  exists: "That address is already on the list.",
  busy: "Too many changes this hour. Please wait a little.",
  missing: "That source or page no longer exists.",
  ok_page: "Page added.",
  ok_page_removed: "Page removed.",
  page_url: "A page must be a full https address inside the website's address.",
  page_exists: "That page is already listed.",
  code: "Unknown subject.",
  ok_folders: "Google Drive folders added.",
  ok_folder_removed: "Google Drive folder removed.",
  folder_exists: "Those folders are already on the list.",
  folder_bad: "No Google Drive folder links found. Paste links like https://drive.google.com/drive/folders/...",
};

type Site = { id: string; name: string; base_url: string; enabled: number; notes: string; kind: string };
type Folder = { id: string; site_id: string; folder_id: string; label: string; last_seen: string; last_seen_at: number | null };
type Seen = { name?: string; looksLike?: string; pdfs?: number; folders?: number; forThisSyllabus?: number; years?: [number, number] | null; error?: string };
const seenOf = (j: string): Seen => { try { return JSON.parse(j) as Seen; } catch { return {}; } };
type Page = { id: string; site_id: string; syllabus_code: string; url: string; last_scan: string; last_scan_at: number | null };

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ e?: string; remove?: string; removepage?: string; removefolder?: string; ref?: string; added?: string; dupes?: string; bad?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const [{ results: sites }, { results: pages }, { results: folders }, subjects, aliases, { results: stored }] = await Promise.all([
    env.DB.prepare(LIST_SITES).all<Site>(),
    env.DB.prepare(`SELECT id, site_id, syllabus_code, url, last_scan, last_scan_at FROM source_page ORDER BY url`).all<Page>(),
    env.DB.prepare(`SELECT id, site_id, folder_id, label, last_seen, last_seen_at FROM source_drive_folder ORDER BY created_at`).all<Folder>(),
    listSubjects(env.DB),
    loadAliases(env.DB),
    env.DB.prepare(`SELECT file_name FROM source_document WHERE status = 'stored'`).all<{ file_name: string }>(),
  ]);
  const have = new Set(stored.map((r) => r.file_name));
  const codes = subjects.map((s) => s.code);
  const webSites = sites.filter((s) => s.kind !== "gdrive");
  const drive = sites.find((s) => s.kind === "gdrive" && s.enabled) ?? sites.find((s) => s.kind === "gdrive");
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "Website";
  const siteOn = (id: string) => !!sites.find((s) => s.id === id)?.enabled;
  const looseFolders = folders.filter((f) => !folderCode(f.label, codes));
  const quals = [...new Set(subjects.map((s) => s.qualification))];
  const counts = (n: string | undefined) => (n && /^\d{1,3}$/.test(n) ? Number(n) : 0);

  const folderRow = (f: Folder) => {
    const seen = seenOf(f.last_seen);
    return (
      <li className="list-row" key={f.id}>
        <span className="doc-main">
          <span>{f.label || seen.name || "Unnamed Google Drive folder"}{seen.looksLike ? <span className="muted"> · looks like {seen.looksLike}</span> : null}</span>
          <span className="muted">
            {seen.error ? `Last run: ${seen.error}` : seen.pdfs !== undefined
              ? `${seen.pdfs} PDFs in ${seen.folders ?? 0} folders${seen.years ? `, ${seen.years[0]} to ${seen.years[1]}` : ""}${f.last_seen_at ? ` (read ${day(f.last_seen_at)})` : ""}`
              : "Not read by the agent yet"}
          </span>
          <a className="link" href={`https://drive.google.com/drive/folders/${encodeURIComponent(f.folder_id)}`} rel="noopener noreferrer" target="_blank">Open in Google Drive</a>
        </span>
        {q.removefolder === f.id ? (
          <span className="confirm">
            <span>Remove this folder?</span>
            <form method="post" action="/admin/sources/folders/remove">
              <input type="hidden" name="id" value={f.id} />
              <button className="btn btn-small btn-danger" type="submit">Yes, remove</button>
            </form>
            <Link className="btn btn-small" href="/admin/sources">Never mind</Link>
          </span>
        ) : (
          <Link className="btn btn-small" href={`/admin/sources?removefolder=${encodeURIComponent(f.id)}`}>Remove</Link>
        )}
      </li>
    );
  };

  return (
    <AdminShell current="/admin/sources" title="Sources">
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      {q.e === "ok_folders" || q.e === "folder_exists" ? (
        <p className="muted">Added {counts(q.added)}, already listed {counts(q.dupes)}, not a folder link {counts(q.bad)}.</p>
      ) : null}
      <p className="muted">
        Where each subject&apos;s files come from: Cambridge&apos;s own pages and shared Google Drive folders. The agent only
        uses sources that are switched on (bottom of the page), and follows each website&apos;s robots.txt.
      </p>

      {quals.map((qual) => (
        <section className="stack" key={qual}>
          <h2 className="subtitle">{qual}</h2>
          {subjects.filter((s) => s.qualification === qual).map((s) => {
            const own = pages.filter((p) => p.syllabus_code === s.code);
            const dirs = folders.filter((f) => folderCode(f.label, codes) === s.code);
            const scans = own.map((p) => ({ p, scan: scanSummary(p.last_scan, s.code, have) }));
            const offered = new Set(scans.flatMap(({ scan }) => scan.files.map((f) => f.name ?? f.url)));
            const missing = new Set(scans.flatMap(({ scan }) => scan.missing));
            const series = aliases.filter((a) => a.main_code === s.code);
            return (
              <details className="card group" key={s.code} id={`s-${s.code}`}>
                <summary className="group-head">
                  <span className="subtitle">{s.label}</span>
                  <span className="muted">
                    {own.length} Cambridge page{own.length === 1 ? "" : "s"} · {dirs.length} Google Drive folder{dirs.length === 1 ? "" : "s"}
                    {offered.size ? ` · Cambridge offers ${offered.size} files, ${missing.size ? `${missing.size} not in the library yet` : "all in the library"}` : ""}
                  </span>
                </summary>
                <div className="group-body stack">
                  {series.length ? (
                    <p className="muted">Also stored with this subject: {series.map((a) => aliasLabel(a)).join(", ")}.</p>
                  ) : null}

                  <div className="pages">
                    <span className="label-inline">Cambridge and other websites</span>
                    {own.length === 0 ? <span className="muted">No pages yet.</span> : null}
                    <ul className="list">
                      {scans.map(({ p, scan }) => (
                        <li className="list-row" key={p.id}>
                          <span className="doc-main">
                            <span>{pageKind(p.url)} <span className="muted">on {siteName(p.site_id)}{siteOn(p.site_id) ? "" : " (switched off)"}</span></span>
                            <a className="link mono" href={p.url} rel="noopener noreferrer" target="_blank">{p.url}</a>
                            {p.last_scan_at ? (
                              <span>
                                {scan.total} file{scan.total === 1 ? "" : "s"} on this page (checked {day(p.last_scan_at)}): {scan.have} in the library
                                {scan.missing.length ? `, ${scan.missing.length} not yet` : ""}{scan.unnamed ? `, ${scan.unnamed} not exam files` : ""}.
                              </span>
                            ) : <span className="muted">Not checked yet.</span>}
                            {scan.missingText ? <span className="muted">Not in the library yet: {scan.missingText}.</span> : null}
                            {scan.total ? (
                              <details>
                                <summary className="link">Show the {scan.total} files</summary>
                                <ul className="list">
                                  {scan.files.map((f) => (
                                    <li key={f.url} className="list-row">
                                      <a className="link mono" href={f.url} rel="noopener noreferrer" target="_blank">{f.name ?? f.url.split("/").pop()}</a>
                                      <span className={f.have ? "event-good" : "muted"}>{f.have ? "In the library" : f.name ? "Not yet" : "Not an exam file"}</span>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                          </span>
                          {q.removepage === p.id ? (
                            <span className="confirm">
                              <span>Remove this page?</span>
                              <form method="post" action="/admin/sources/pages/remove">
                                <input type="hidden" name="id" value={p.id} />
                                <button className="btn btn-small btn-danger" type="submit">Yes, remove</button>
                              </form>
                              <Link className="btn btn-small" href="/admin/sources">Never mind</Link>
                            </span>
                          ) : (
                            <Link className="btn btn-small" href={`/admin/sources?removepage=${encodeURIComponent(p.id)}`}>Remove</Link>
                          )}
                        </li>
                      ))}
                    </ul>
                    {webSites.length ? (
                      <form className="inline-form" method="post" action="/admin/sources/pages/add">
                        <input type="hidden" name="code" value={s.code} />
                        <label className="sr-only" htmlFor={`site-${s.code}`}>Website</label>
                        <select className="input review-select" id={`site-${s.code}`} name="site" defaultValue={webSites[0]!.id}>
                          {webSites.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                        <label className="sr-only" htmlFor={`page-${s.code}`}>New page for {s.label}</label>
                        <input className="input" id={`page-${s.code}`} name="url" type="url" required maxLength={300} placeholder="https://..." />
                        <button className="btn btn-small" type="submit">Add page</button>
                      </form>
                    ) : null}
                  </div>

                  <div className="pages">
                    <span className="label-inline">Google Drive folders</span>
                    {dirs.length === 0 ? <span className="muted">No folders yet.</span> : null}
                    <ul className="list">{dirs.map(folderRow)}</ul>
                    {drive ? (
                      <form className="stack-tight" method="post" action="/admin/sources/folders/add">
                        <input type="hidden" name="site" value={drive.id} />
                        <input type="hidden" name="code" value={s.code} />
                        <label className="label-inline" htmlFor={`links-${s.code}`}>Add folders for {s.label}: one shared folder link per line</label>
                        <textarea className="input textarea" id={`links-${s.code}`} name="links" rows={2} maxLength={10000} required placeholder="https://drive.google.com/drive/folders/..." />
                        <button className="btn btn-small" type="submit">Add folders</button>
                      </form>
                    ) : null}
                  </div>

                  <div className="actions">
                    <Link className="btn btn-small" href={`/admin/agent?code=${encodeURIComponent(s.code)}`}>Run the agent for this subject</Link>
                    <Link className="btn btn-small" href={`/admin/library/${encodeURIComponent(s.code)}`}>Open in the library</Link>
                  </div>
                </div>
              </details>
            );
          })}
        </section>
      ))}

      {looseFolders.length ? (
        <section className="card stack" id="loose-folders">
          <h2 className="subtitle">Google Drive folders not linked to a subject</h2>
          <p className="muted">Their names do not say a library subject. The agent still reads them for every subject.</p>
          <ul className="list">{looseFolders.map(folderRow)}</ul>
        </section>
      ) : null}

      <section className="card stack" id="sites">
        <h2 className="subtitle">Websites and Google Drive</h2>
        <p className="muted">Switch a source off to stop the agent using it for every subject.</p>
        <ul className="list">
          {sites.map((s) => (
            <li className="list-row" key={s.id}>
              <span className="doc-main">
                <span>{s.name} <span className={s.enabled ? "pill pill-ok" : "pill"}>{s.enabled ? "On" : "Off"}</span></span>
                <span className="mono muted">{s.base_url}</span>
                {s.notes ? <span className="muted">{s.notes}</span> : null}
              </span>
              {q.remove === s.id ? (
                <span className="confirm">
                  <span>Remove this source and all its pages or folders?</span>
                  <form method="post" action="/admin/sources/remove">
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn btn-small btn-danger" type="submit">Yes, remove</button>
                  </form>
                  <Link className="btn btn-small" href="/admin/sources">Never mind</Link>
                </span>
              ) : (
                <span className="actions">
                  <form method="post" action="/admin/sources/toggle">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="enabled" value={s.enabled ? "0" : "1"} />
                    <button className="btn btn-small" type="submit">{s.enabled ? "Switch off" : "Switch on"}</button>
                  </form>
                  <Link className="btn btn-small" href={`/admin/sources?remove=${encodeURIComponent(s.id)}`}>Remove</Link>
                </span>
              )}
            </li>
          ))}
        </ul>
        <details>
          <summary className="link">Add a website</summary>
          <form className="stack" method="post" action="/admin/sources/add">
            <label className="label" htmlFor="name">Name</label>
            <input className="input" id="name" name="name" required maxLength={80} />
            <label className="label" htmlFor="url">Address (https)</label>
            <input className="input" id="url" name="url" type="url" required maxLength={300} placeholder="https://www.example.org/papers/" />
            <label className="label" htmlFor="notes">Notes (optional)</label>
            <input className="input" id="notes" name="notes" maxLength={300} />
            <button className="btn btn-primary" type="submit">Add source</button>
          </form>
        </details>
      </section>
    </AdminShell>
  );
}
