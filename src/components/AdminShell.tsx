import Link from "next/link";
import { getEnv } from "@/lib/env";
import { aiUsageToday } from "@/lib/agent/usage";
import { AI_USAGE } from "@/lib/config";
import { AdminEnhance } from "@/components/AdminEnhance";
import { AppIcon } from "@/components/icons/AppIcon";
import { readIcons } from "@/lib/icons";
import { allowed, staffSession, type Need } from "@/lib/auth/staff";

/**
 * The sidebar, in groups (owner, 6 Nov 2026). `current` on a page names the item it belongs to. `need`: what a team
 * member needs to see the item (owner, 9 Nov 2026); items without it are the owner's only.
 */
type NavItem = { href: string; label: string; icon: string; need?: Need };
const NAV: readonly { group: string | null; items: readonly NavItem[] }[] = [
  { group: null, items: [{ href: "/admin", label: "Home", icon: "admin.home", need: null }] },
  {
    group: "Library",
    items: [
      { href: "/admin/library", label: "Library", icon: "admin.library", need: { area: "library", level: "view" } },
      { href: "/admin/library/upload", label: "Upload", icon: "admin.upload", need: { area: "library", level: "edit" } },
      { href: "/admin/sources", label: "Sources", icon: "admin.sources" },
      { href: "/admin/agent", label: "Agent", icon: "admin.agent" },
    ],
  },
  { group: "Subject brain", items: [{ href: "/admin/topics", label: "Topic trees", icon: "admin.topics" }] },
  {
    group: "Users",
    items: [
      { href: "/admin/users/team", label: "Team", icon: "admin.team" },
      { href: "/admin/users/accounts", label: "Students and parents", icon: "admin.accounts" },
      { href: "/admin/approval", label: "Parent approval", icon: "admin.approval" },
    ],
  },
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
 * and the page's main actions on the right, kept in view while the page scrolls. Runs going on show on the page that started
 * them and on Home (owner, 9 Nov 2026: not in the sidebar). Pages still call requireAdmin() themselves.
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
  const [ai, icons, staff] = await Promise.all([aiUsageToday(db), readIcons(db), staffSession()]);
  // A team member sees only what they may use; the owner sees everything.
  const show = (n: NavItem) => !!staff && (staff.owner || (n.need !== undefined && allowed(staff, n.need)));
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter(show) })).filter((g) => g.items.length);
  return (
    <div className="admin">
      <a className="skip-link" href="#main">Skip to the page</a>
      <aside className="admin-side">
        <nav className="side-nav" aria-label="Admin">
          {nav.map((g) => (
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
          {staff?.owner ? (
            <span className={ai.share >= 90 ? "ai-meter ai-meter-high" : "ai-meter"} title={`Workers AI questions today (UTC) and an estimate of Cloudflare's free ${AI_USAGE.freeNeuronsPerDay.toLocaleString("en-GB")} daily units used. Cloudflare's dashboard has the exact figure.`}>
              AI today: {ai.calls} question{ai.calls === 1 ? "" : "s"}, {ai.share}% of free allowance
              <progress className="ai-meter-bar" max={100} value={Math.min(ai.share, 100)}>{ai.share}%</progress>
            </span>
          ) : staff ? <span className="side-who">Signed in as {staff.name} (team)</span> : null}
          {/* The owner signs out of the admin; a team member out of their email sign-in. */}
          <form method="post" action={staff && !staff.owner ? "/account/signout" : "/admin/session/end"}>
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
