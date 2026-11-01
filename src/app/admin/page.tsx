import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { recentAudit } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Admin" };

const ACTION_LABELS: Record<string, string> = {
  "admin.login": "Signed in",
  "admin.logout": "Signed out",
  "admin.login_failed": "Wrong password",
  "admin.login_locked": "Sign-in locked (too many tries)",
};

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Karachi",
});

export default async function AdminHome() {
  await requireAdmin();
  const env = await getEnv();
  const events = await recentAudit(env.DB, 15);
  return (
    <main className="shell">
      <header className="topbar">
        <h1 className="title">Admin</h1>
        <form method="post" action="/admin/session/end">
          <button className="btn" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="card stack">
        <h2 className="subtitle">Source library</h2>
        <p className="muted">Coming next: Cambridge papers, mark schemes and the download agent.</p>
      </section>

      <section className="card stack">
        <h2 className="subtitle">Recent activity</h2>
        {events.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="list">
            {events.map((ev, i) => (
              <li className="list-row" key={i}>
                <span>{ACTION_LABELS[ev.action] ?? ev.action}</span>
                <time className="muted" dateTime={new Date(ev.at).toISOString()}>
                  {dateFmt.format(ev.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
