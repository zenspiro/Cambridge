import Link from "next/link";
import { getEnv } from "@/lib/env";
import { aiUsageToday } from "@/lib/agent/usage";
import { AI_USAGE } from "@/lib/config";

/** The sidebar, in groups (owner, 6 Nov 2026). `current` on a page names the item it belongs to. */
const NAV: readonly { group: string | null; items: readonly { href: string; label: string }[] }[] = [
  { group: null, items: [{ href: "/admin", label: "Home" }] },
  {
    group: "Library",
    items: [
      { href: "/admin/library", label: "Library" },
      { href: "/admin/library/upload", label: "Upload" },
      { href: "/admin/sources", label: "Sources" },
      { href: "/admin/agent", label: "Agent" },
    ],
  },
  { group: "Subject brain", items: [{ href: "/admin/topics", label: "Topic trees" }] },
  { group: "Students and parents", items: [{ href: "/admin/approval", label: "Parent approval" }] },
  {
    group: "Settings",
    items: [
      { href: "/admin/settings", label: "Library settings" },
      { href: "/admin/ai", label: "AI setup" },
      { href: "/admin/brand", label: "Brand" },
      { href: "/admin/themes", label: "Themes" },
    ],
  },
];

/** Frame for every signed-in admin page: a sidebar and the page using the rest of the width. Pages still call requireAdmin() themselves. */
export async function AdminShell({ current, title, children }: { current: string; title: string; children: React.ReactNode }) {
  const ai = await aiUsageToday((await getEnv()).DB);
  return (
    <div className="admin">
      <aside className="admin-side">
        <nav className="side-nav" aria-label="Admin">
          {NAV.map((g) => (
            <div className="side-group" key={g.group ?? "top"}>
              {g.group ? <p className="side-heading">{g.group}</p> : null}
              {g.items.map((n) => (
                <Link key={n.href} href={n.href} className="side-link" aria-current={n.href === current ? "page" : undefined}>
                  {n.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span className={ai.share >= 90 ? "ai-meter ai-meter-high" : "ai-meter"} title={`Workers AI questions today (UTC) and an estimate of Cloudflare's free ${AI_USAGE.freeNeuronsPerDay.toLocaleString("en-GB")} daily units used. Cloudflare's dashboard has the exact figure.`}>
            AI today: {ai.calls} question{ai.calls === 1 ? "" : "s"}, {ai.share}% of free allowance
            <progress className="ai-meter-bar" max={100} value={Math.min(ai.share, 100)}>{ai.share}%</progress>
          </span>
          <form method="post" action="/admin/session/end">
            <button className="btn btn-small" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="admin-main">
        <h1 className="title page-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}

/** Fixed messages by code, so nothing from the address bar is shown as text. */
export function Notice({ code, messages, errorRef }: { code: string | undefined; messages: Record<string, string>; errorRef?: string }) {
  if (errorRef && /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/.test(errorRef)) {
    return (
      <p className="alert" role="alert">
        Something went wrong. Reference: {errorRef}
      </p>
    );
  }
  if (!code || !Object.hasOwn(messages, code)) return null;
  const good = code.startsWith("ok");
  return (
    <p className={good ? "notice" : "alert"} role={good ? "status" : "alert"}>
      {messages[code]}
    </p>
  );
}
