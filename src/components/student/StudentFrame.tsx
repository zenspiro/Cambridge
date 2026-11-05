// The frame of every student and parent page: brand at the top, the menu (bottom on phones, side on wide screens),
// the footer statement. No server or client APIs, so server pages and the theme gallery (client) both use it.
import type { ReactNode } from "react";
import type { ThemeId } from "@/lib/config";
import { Icon, type IconName } from "./Icons";

/** What the frame needs from the Brand page, already turned into addresses and text. */
export type FrameBrand = { name: string; logoUrl?: string; squareUrl?: string; footer: string };
export type NavItem = { href: string; label: string; icon: IconName };

export function StudentFrame({
  brand,
  theme,
  nav,
  current,
  children,
}: {
  brand: FrameBrand;
  theme: ThemeId;
  nav: readonly NavItem[];
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="s-app" data-theme={theme}>
      <div className="s-frame">
        <header className="s-top">
          <a className="s-brand" href={nav[0]?.href ?? "/"}>
            {brand.logoUrl ? (
              <img className="s-logo" src={brand.logoUrl} alt={brand.name} />
            ) : (
              <>
                {brand.squareUrl ? <img className="s-logo-square" src={brand.squareUrl} alt="" /> : null}
                <span>{brand.name}</span>
              </>
            )}
          </a>
        </header>
        <div className="s-body">
          <nav className="s-nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.href} className="s-nav-link" href={n.href} aria-current={n.href === current ? "page" : undefined}>
                <Icon name={n.icon} />
                {n.label}
              </a>
            ))}
          </nav>
          <main className="s-main">{children}</main>
        </div>
        <footer className="s-footer">{brand.footer}</footer>
      </div>
    </div>
  );
}
