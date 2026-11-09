import type { NavItem } from "./StudentFrame";

/** A menu item before its icon is looked up: `slot` names its place in Settings > Icons. */
export type NavSlot = Omit<NavItem, "icon"> & { slot: string };

/** Menus of the signed-in student and parent pages. */
export const STUDENT_NAV: readonly NavSlot[] = [
  { href: "/student", label: "Home", slot: "student.home" },
  { href: "/me", label: "Me", slot: "student.me" },
];
export const PARENT_NAV: readonly NavSlot[] = [
  { href: "/parent", label: "Family", slot: "parent.family" },
  { href: "/me", label: "Me", slot: "parent.me" },
];

/** A menu with each item's icon as chosen in Settings > Icons (`icons` from readIcons). */
export const withIcons = (nav: readonly NavSlot[], icons: Readonly<Record<string, string>>): NavItem[] =>
  nav.map(({ slot, ...n }) => ({ ...n, icon: icons[slot] ?? "circle-help" }));
