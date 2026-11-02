import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { recentAudit } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { COUNT_ALL_DOCUMENTS } from "@/lib/library/queries";
import { dateFmt } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Admin" };

const ACTION_LABELS: Record<string, string> = {
  "admin.login": "Signed in",
  "admin.logout": "Signed out",
  "admin.login_failed": "Wrong password",
  "admin.login_locked": "Sign-in locked (too many tries)",
  "source.upload": "Uploaded a source file",
  "source.agent": "Agent stored a source file",
  "source.link": "Added a source file from a link",
  "source.download": "Downloaded a source file",
  "source_site.add": "Added a source website",
  "source_site.enable": "Switched on a source website",
  "source_site.disable": "Switched off a source website",
  "source_site.remove": "Removed a source website",
  "source_page.add": "Added a start page",
  "source_page.remove": "Removed a start page",
  "setting.library": "Changed library settings",
  "syllabus.variants": "Changed a syllabus's essential variants",
  "agent.start_dry": "Started an agent dry run",
  "agent.start_download": "Started an agent download",
  "agent.finish": "Agent run finished",
  "agent.fail": "Agent run failed",
  "agent.cancel": "Cancelled an agent run",
};

export default async function AdminHome() {
  await requireAdmin();
  const env = await getEnv();
  const [events, count] = await Promise.all([
    recentAudit(env.DB, 15),
    env.DB.prepare(COUNT_ALL_DOCUMENTS).first<{ n: number; subjects: number }>(),
  ]);
  return (
    <AdminShell current="/admin" title="Admin">
      <section className="card stack">
        <h2 className="subtitle">Source library</h2>
        <p className="muted">
          {count?.n ?? 0} files stored, across {count?.subjects ?? 0} subject{count?.subjects === 1 ? "" : "s"}. <Link className="link" href="/admin/library">See the library</Link>.
        </p>
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
    </AdminShell>
  );
}
