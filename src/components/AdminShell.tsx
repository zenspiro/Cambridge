import Link from "next/link";

const NAV = [
  { href: "/admin", label: "Home" },
  { href: "/admin/library", label: "Library" },
  { href: "/admin/library/upload", label: "Upload" },
  { href: "/admin/agent", label: "Agent" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/settings", label: "Settings" },
] as const;

/** Frame for every signed-in admin page. Pages still call requireAdmin() themselves. */
export function AdminShell({ current, title, children }: { current: string; title: string; children: React.ReactNode }) {
  return (
    <div className="shell shell-wide">
      <header className="topbar">
        <nav className="nav" aria-label="Admin">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link" aria-current={n.href === current ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <form method="post" action="/admin/session/end">
          <button className="btn btn-small" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main>
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
