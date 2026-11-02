import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { LIST_SITES } from "@/lib/library/queries";

export const metadata: Metadata = { title: "Approved sources" };

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
  ok_page: "Start page added.",
  ok_page_removed: "Start page removed.",
  page_url: "A start page must be a full https address inside the source's address.",
  page_exists: "That start page is already listed.",
  code: "Unknown syllabus code.",
  ok_folders: "Google Drive folders added.",
  ok_folder_removed: "Google Drive folder removed.",
  folder_exists: "Those folders are already on the list.",
  folder_bad: "No Google Drive folder links found. Paste links like https://drive.google.com/drive/folders/...",
};

type Site = { id: string; name: string; base_url: string; enabled: number; notes: string; kind: string };
type Folder = { id: string; site_id: string; folder_id: string; label: string; last_seen: string; last_seen_at: number | null };
type Seen = { name?: string; looksLike?: string; pdfs?: number; folders?: number; forThisSyllabus?: number; years?: [number, number] | null; error?: string };
const seenOf = (j: string): Seen => { try { return JSON.parse(j) as Seen; } catch { return {}; } };
type Page = { id: string; site_id: string; syllabus_code: string; url: string };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ e?: string; remove?: string; removepage?: string; removefolder?: string; ref?: string; added?: string; dupes?: string; bad?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const [{ results: sites }, { results: pages }, { results: folders }] = await Promise.all([
    env.DB.prepare(LIST_SITES).all<Site>(),
    env.DB.prepare(`SELECT id, site_id, syllabus_code, url FROM source_page ORDER BY created_at`).all<Page>(),
    env.DB.prepare(`SELECT id, site_id, folder_id, label, last_seen, last_seen_at FROM source_drive_folder ORDER BY created_at`).all<Folder>(),
  ]);
  const counts = (n: string | undefined) => (n && /^\d{1,3}$/.test(n) ? Number(n) : 0);

  return (
    <AdminShell current="/admin/sources" title="Approved sources">
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      {q.e === "ok_folders" || q.e === "folder_exists" ? (
        <p className="muted">Added {counts(q.added)}, already listed {counts(q.dupes)}, not a folder link {counts(q.bad)}.</p>
      ) : null}
      <p className="muted">
        The download agent only visits switched-on sources. Websites: it reads the start pages and follows each site&apos;s
        robots.txt. Google Drive: add a source with the address https://drive.google.com/ and paste the shared folder links.
        Adding a source is your call.
      </p>

      <section className="card stack">
        <ul className="list">
          {sites.map((s) => (
            <li className="list-row" key={s.id}>
              <span className="doc-main">
                <span>
                  {s.name} <span className={s.enabled ? "pill pill-ok" : "pill"}>{s.enabled ? "On" : "Off"}</span>
                </span>
                <span className="mono muted">{s.base_url}</span>
                {s.notes ? <span className="muted">{s.notes}</span> : null}
              </span>
              {q.remove === s.id ? (
                <span className="confirm">
                  <span>Remove this source?</span>
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
              {s.kind === "gdrive" ? (
                <div className="pages">
                  <span className="label-inline">Google Drive folders</span>
                  <span className="muted">
                    The agent walks each folder through Google&apos;s Drive API and works out the subject, year, session and paper from
                    the folder and file names. Folders must be shared as &quot;anyone with the link&quot;.
                  </span>
                  {folders.filter((f) => f.site_id === s.id).length === 0 ? <span className="muted">No folders yet.</span> : null}
                  <ul className="list">
                    {folders.filter((f) => f.site_id === s.id).map((f) => {
                      const seen = seenOf(f.last_seen);
                      return (
                        <li className="list-row" key={f.id}>
                          <span className="doc-main">
                            <span>{f.label || seen.name || "Unnamed Google Drive folder"}{seen.looksLike ? <span className="muted"> · looks like {seen.looksLike}</span> : null}</span>
                            <span className="muted">
                              {seen.error ? `Last run: ${seen.error}` : seen.pdfs !== undefined
                                ? `${seen.pdfs} PDFs in ${seen.folders ?? 0} folders${seen.years ? `, ${seen.years[0]} to ${seen.years[1]}` : ""}; ${seen.forThisSyllabus ?? 0} recognised for the syllabus run`
                                : "Not read by the agent yet"}
                            </span>
                            <a className="muted link" href={`https://drive.google.com/drive/folders/${encodeURIComponent(f.folder_id)}`} rel="noopener noreferrer" target="_blank">Open in Google Drive</a>
                          </span>
                          {q.removefolder === f.id ? (
                            <span className="confirm">
                              <span>Remove {f.label || "this folder"}?</span>
                              <form method="post" action="/admin/sources/folders/remove">
                                <input type="hidden" name="id" value={f.id} />
                                <button className="btn btn-small btn-danger" type="submit">Yes, remove</button>
                              </form>
                              <Link className="btn btn-small" href="/admin/sources">Never mind</Link>
                            </span>
                          ) : (
                            <Link className="btn btn-small" href={`/admin/sources?removefolder=${encodeURIComponent(f.id)}`}>Remove folder</Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <form className="stack-tight" method="post" action="/admin/sources/folders/add">
                    <input type="hidden" name="site" value={s.id} />
                    <label className="label-inline" htmlFor={`links-${s.id}`}>Add folders: paste one Google Drive folder link per line (up to 50)</label>
                    <textarea className="input textarea" id={`links-${s.id}`} name="links" rows={4} maxLength={10000} required placeholder="https://drive.google.com/drive/folders/..." />
                    <button className="btn btn-small" type="submit">Add folders</button>
                  </form>
                </div>
              ) : (
              <div className="pages">
                <span className="label-inline">Start pages</span>
                {pages.filter((pg) => pg.site_id === s.id).length === 0 ? <span className="muted">None yet. The agent skips this source.</span> : null}
                <ul className="list">
                  {pages
                    .filter((pg) => pg.site_id === s.id)
                    .map((pg) => (
                      <li className="list-row" key={pg.id}>
                        <span className="mono muted">{pg.syllabus_code}: {pg.url}</span>
                        {q.removepage === pg.id ? (
                          <span className="confirm">
                            <span>Remove this page?</span>
                            <form method="post" action="/admin/sources/pages/remove">
                              <input type="hidden" name="id" value={pg.id} />
                              <button className="btn btn-small btn-danger" type="submit">Yes, remove</button>
                            </form>
                            <Link className="btn btn-small" href="/admin/sources">Never mind</Link>
                          </span>
                        ) : (
                          <Link className="btn btn-small" href={`/admin/sources?removepage=${encodeURIComponent(pg.id)}`}>Remove page</Link>
                        )}
                      </li>
                    ))}
                </ul>
                <form className="inline-form" method="post" action="/admin/sources/pages/add">
                  <input type="hidden" name="site" value={s.id} />
                  <input type="hidden" name="code" value="0625" />
                  <label className="sr-only" htmlFor={`page-${s.id}`}>New start page for {s.name}</label>
                  <input className="input" id={`page-${s.id}`} name="url" type="url" required maxLength={300} placeholder={`${s.base_url}...`} />
                  <button className="btn btn-small" type="submit">Add page</button>
                </form>
              </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form className="card stack" method="post" action="/admin/sources/add">
        <h2 className="subtitle">Add a source</h2>
        <label className="label" htmlFor="name">Name</label>
        <input className="input" id="name" name="name" required maxLength={80} />
        <label className="label" htmlFor="url">Address (https)</label>
        <input className="input" id="url" name="url" type="url" required maxLength={300} placeholder="https://www.example.org/papers/" />
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <input className="input" id="notes" name="notes" maxLength={300} />
        <button className="btn btn-primary btn-block" type="submit">Add source</button>
      </form>
    </AdminShell>
  );
}
