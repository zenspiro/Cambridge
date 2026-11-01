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
  missing: "That source no longer exists.",
};

type Site = { id: string; name: string; base_url: string; enabled: number; notes: string };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ e?: string; remove?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const { results: sites } = await env.DB.prepare(LIST_SITES).all<Site>();

  return (
    <AdminShell current="/admin/sources" title="Approved sources">
      <Notice code={q.e} messages={MESSAGES} />
      {q.ref && /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/.test(q.ref) ? (
        <p className="alert" role="alert">Something went wrong. Reference: {q.ref}</p>
      ) : null}
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
