import Link from "next/link";
import { getEnv } from "@/lib/env";
import { aiUsageToday } from "@/lib/agent/usage";
import { AI_USAGE } from "@/lib/config";
import { activeRuns } from "@/lib/adminStatus";
import { AdminEnhance } from "@/components/AdminEnhance";
import { AppIcon } from "@/components/icons/AppIcon";
import { readIcons } from "@/lib/icons";

/** The sidebar, in groups (owner, 6 Nov 2026). `current` on a page names the item it belongs to. */
const NAV: readonly { group: string | null; items: readonly { href: string; label: string; icon: string }[] }[] = [
  { group: null, items: [{ href: "/admin", label: "Home", icon: "admin.home" }] },
  {
    group: "Library",
    items: [
      { href: "/admin/library", label: "Library", icon: "admin.library" },
      { href: "/admin/library/upload", label: "Upload", icon: "admin.upload" },
      { href: "/admin/sources", label: "Sources", icon: "admin.sources" },
      { href: "/admin/agent", label: "Agent", icon: "admin.agent" },
    ],
  },
  { group: "Subject brain", items: [{ href: "/admin/topics", label: "Topic trees", icon: "admin.topics" }] },
  { group: "Students and parents", items: [{ href: "/admin/approval", label: "Parent approval", icon: "admin.approval" }] },
  {
    group: "Settings",
    items: [
      { href: "/admin/settings", label: "Library settings", icon: "admin.settings" },
      { href: "/admin/ai", label: "AI setup", icon: "admin.ai" },
      { href: "/admin/brand", label: "Brand", icon: "admin.brand" },
      { href: "/admin/themes", label: "Themes", icon: "admin.themes" },
      { href: "/admin/icons", label: "Icons", icon: "admin.icons" },
    ],
  },
];

export type Crumb = { label: string; href?: string };

/**
 * Frame for every signed-in admin page: a sidebar and the page using the rest of the width. Every page has the same
 * header (owner, 8 Nov 2026: a standard, functional admin): breadcrumbs, the title, one line on what the page is for,
 * and the page's main actions on the right, kept in view while the page scrolls. The sidebar shows the runs going on
 * now with links. Pages still call requireAdmin() themselves.
 */
export async function AdminShell({ current, title, children, intro, actions, crumbs, keepHead = true }: {
  current: string; title: string; children: React.ReactNode;
  /** One or two sentences: what the page is for. */
  intro?: React.ReactNode;
  /** The page's main actions (buttons or links styled as buttons). */
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  /** Keep the header in view while scrolling (off for working screens that need the height, like the review screen). */
  keepHead?: boolean;
}) {
  const db = (await getEnv()).DB;
  const [ai, runs, icons] = await Promise.all([aiUsageToday(db), activeRuns(db), readIcons(db)]);
  return (
    <div className="admin">
      <a className="skip-link" href="#main">Skip to the page</a>
      <aside className="admin-side">
        <nav className="side-nav" aria-label="Admin">
          {NAV.map((g) => (
            <div className="side-group" key={g.group ?? "top"}>
              {g.group ? <p className="side-heading">{g.group}</p> : null}
              {g.items.map((n) => (
                <Link key={n.href} href={n.href} className="side-link" aria-current={n.href === current ? "page" : undefined}>
                  <AppIcon name={icons[n.icon] ?? "circle-help"} className="side-icon" />
                  {n.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {runs.length ? (
            <div className="side-runs" id="running-now">
              <p className="side-heading">Running now</p>
              {runs.map((r) => (
                <a key={r.id} className="side-run" href={r.href}>
                  <span className={r.queued ? "run-dot run-dot-wait" : "run-dot"} aria-hidden="true" />
                  <span className="side-run-text">
                    <span>{r.label}</span>
                    <span className="side-run-step">{r.queued ? "Waiting to start" : r.step ?? "Working"}</span>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
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
      <main className="admin-main" id="main">
        <header className={keepHead ? "page-head page-head-kept" : "page-head"}>
          {crumbs?.length ? <Crumbs items={crumbs} /> : null}
          <div className="page-head-row">
            <h1 className="title page-title">{title}</h1>
            {actions ? <div className="page-actions">{actions}</div> : null}
          </div>
          {intro ? <p className="page-intro">{intro}</p> : null}
        </header>
        {children}
      </main>
      <AdminEnhance />
    </div>
  );
}

/** Breadcrumbs: where the page sits, each level a link back. */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span className="crumb" key={i}>
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {it.href ? <Link className="link" href={it.href}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** A section's empty state: what is missing and what to do about it. */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
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
