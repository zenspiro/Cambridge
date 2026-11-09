// One icon from the chosen set by name (owner, 9 Nov 2026). Colour comes from the text colour, so admin and every
// student theme restyle it. Decorative: the words beside it carry the meaning. No server or client APIs.
import { ICONS } from "./set";

export function AppIcon({ name, className = "app-icon" }: { name: string; className?: string }) {
  const I = Object.hasOwn(ICONS, name) ? ICONS[name]! : ICONS["circle-help"]!;
  return <I className={className} aria-hidden="true" focusable="false" strokeWidth={2} />;
}
