import type { NavItem } from "./StudentFrame";

/** Menus of the signed-in student and parent pages. */
export const STUDENT_NAV: readonly NavItem[] = [
  { href: "/student", label: "Home", icon: "home" },
  { href: "/me", label: "Me", icon: "me" },
];
export const PARENT_NAV: readonly NavItem[] = [
  { href: "/parent", label: "Family", icon: "home" },
  { href: "/me", label: "Me", icon: "me" },
];
