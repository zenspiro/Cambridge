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
};

type Site = { id: string; name: string; base_url: string; enabled: number; notes: string };
type Page = { id: string; site_id: string; syllabus_code: string; url: string };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ e?: string; remove?: string; removepage?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const [{ results: sites }, { results: pages }] = await Promise.all([
    env.DB.prepare(LIST_SITES).all<Site>(),
    env.DB.prepare(`SELECT id, site_id, syllabus_code, url FROM source_page ORDER BY created_at`).all<Page>(),
  ]);

  return (
    <AdminShell current="/admin/sources" title="Approved sources">
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <p className="muted">
        The download agent only visits switched-on sources, public pages only: no logins, no paywalls, and it follows
        each site's robots.txt. Adding a source is your call (brief 3.8).
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
