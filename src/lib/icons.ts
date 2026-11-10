// Icons (owner, 9 Nov 2026): every place an icon shows is a named slot with a default; the admin can choose another
// from the set (Settings > Icons). Choices live in the setting `icons` ({ slot: name }). Pure apart from the reads and
// writes, which take the database as a parameter. No Next imports and no icon components (those are in
// src/components/icons/set.ts), so the Worker's logic and tests stay light.
import type { Db } from "./db.ts";
import { audit } from "./auth/session.ts";

/** Every icon in the set, in kebab case, in the order the picker shows them. */
export const ICON_NAMES: readonly string[] = [
  "house", "layout-dashboard", "layout-grid", "gauge", "library", "book-open", "book", "book-marked", "book-text", "book-open-check",
  "notebook", "notebook-pen", "notebook-text", "graduation-cap", "school", "university", "backpack", "pencil-line", "pencil", "pen-line",
  "pen-tool", "highlighter", "eraser", "ruler", "calculator", "sigma", "pi", "percent", "flask-conical", "flask-round",
  "atom", "microscope", "dna", "leaf", "globe", "earth", "map", "map-pin", "compass", "languages",
  "music", "palette", "brush", "code", "terminal", "cpu", "binary", "database", "server", "hard-drive",
  "cloud", "cloud-upload", "cloud-download", "upload", "download", "folder-up", "folder-down", "folder", "folder-open", "folder-tree",
  "folders", "file", "file-text", "files", "file-check", "file-search", "file-plus", "file-question", "paperclip", "archive",
  "inbox", "package", "box", "boxes", "layers", "tag", "tags", "bookmark", "search", "scan-search",
  "list-checks", "list-todo", "list", "list-ordered", "clipboard-list", "clipboard-check", "clipboard", "table", "table-2", "columns-3",
  "rows-3", "chart-bar", "chart-column", "chart-line", "chart-pie", "chart-no-axes-column", "trending-up", "trending-down", "activity", "target",
  "trophy", "medal", "award", "star", "sparkles", "flame", "zap", "rocket", "lightbulb", "brain",
  "brain-circuit", "bot", "message-square", "message-circle", "messages-square", "mail", "send", "bell", "bell-ring", "megaphone",
  "calendar", "calendar-days", "calendar-check", "clock", "timer", "hourglass", "history", "alarm-clock", "user", "users",
  "user-round", "user-plus", "user-check", "user-cog", "baby", "contact", "id-card", "shield", "shield-check", "lock",
  "lock-open", "key", "key-round", "fingerprint", "eye", "eye-off", "settings", "settings-2", "sliders-horizontal", "wrench",
  "hammer", "cog", "bolt", "plug", "link", "link-2", "external-link", "wifi", "paintbrush", "swatch-book",
  "image", "images", "camera", "video", "mic", "headphones", "volume-2", "play", "pause", "circle-play",
  "check", "check-check", "circle-check", "circle-x", "x", "plus", "minus", "circle-help", "info", "triangle-alert",
  "circle-alert", "octagon-alert", "flag", "flag-triangle-right", "ban", "refresh-cw", "rotate-ccw", "repeat", "undo-2", "redo-2",
  "arrow-right", "arrow-left", "arrow-up", "arrow-down", "chevron-right", "chevron-left", "move-right", "shuffle", "list-restart", "heart",
  "thumbs-up", "smile", "laugh", "party-popper", "gift", "coffee", "sun", "moon", "puzzle", "gamepad-2",
  "dices", "crown", "gem", "coins", "wallet", "credit-card", "receipt", "shopping-cart", "store", "building",
  "building-2", "landmark", "handshake", "hand-heart", "life-buoy", "circle-user", "log-in", "log-out", "door-open", "power",
  "trash-2", "pin", "scissors", "copy", "share-2", "printer", "qr-code", "scan-line", "workflow", "network",
  "git-branch", "route", "footprints", "mountain", "bike",
];

export type IconSlot = { id: string; group: string; label: string; default: string };

/** Every place an icon shows, by group, with its default. New places are added here. */
export const ICON_SLOTS: readonly IconSlot[] = [
  { id: "admin.home", group: "Admin menu", label: "Home", default: "house" },
  { id: "admin.library", group: "Admin menu", label: "Library", default: "library" },
  { id: "admin.documents", group: "Admin menu", label: "Documents", default: "table" },
  { id: "admin.upload", group: "Admin menu", label: "Upload", default: "upload" },
  { id: "admin.sources", group: "Admin menu", label: "Sources", default: "globe" },
  { id: "admin.agent", group: "Admin menu", label: "Agent", default: "bot" },
  { id: "admin.topics", group: "Admin menu", label: "Topic trees", default: "folder-tree" },
  { id: "admin.team", group: "Admin menu", label: "Team", default: "user-cog" },
  { id: "admin.accounts", group: "Admin menu", label: "Students and parents", default: "graduation-cap" },
  { id: "admin.approval", group: "Admin menu", label: "Parent approval", default: "shield-check" },
  { id: "admin.settings", group: "Admin menu", label: "Library settings", default: "settings" },
  { id: "admin.ai", group: "Admin menu", label: "AI setup", default: "brain-circuit" },
  { id: "admin.brand", group: "Admin menu", label: "Brand", default: "palette" },
  { id: "admin.themes", group: "Admin menu", label: "Themes", default: "swatch-book" },
  { id: "admin.icons", group: "Admin menu", label: "Icons", default: "sparkles" },
  { id: "student.home", group: "Student menu", label: "Home", default: "house" },
  { id: "student.practice", group: "Student menu", label: "Practice", default: "pencil-line" },
  { id: "student.progress", group: "Student menu", label: "Progress", default: "chart-column" },
  { id: "student.me", group: "Student menu", label: "Me", default: "user-round" },
  { id: "parent.family", group: "Parent menu", label: "Family", default: "users" },
  { id: "parent.me", group: "Parent menu", label: "Me", default: "user-round" },
  { id: "student.streak", group: "Student pages", label: "Practice streak", default: "flame" },
];

const NAMES = new Set(ICON_NAMES);
const SLOTS = new Map(ICON_SLOTS.map((s) => [s.id, s]));

export const isIconName = (v: unknown): v is string => typeof v === "string" && NAMES.has(v);
export const isSlot = (v: unknown): v is string => typeof v === "string" && SLOTS.has(v);

/** Every slot's icon: the admin's choice where it is a known icon, else the default. Pure. */
export function resolveIcons(stored: unknown): Record<string, string> {
  const o = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const s of ICON_SLOTS) {
    const v = Object.hasOwn(o, s.id) ? o[s.id] : undefined;
    out[s.id] = isIconName(v) ? v : s.default;
  }
  return out;
}

async function stored(db: Db): Promise<Record<string, unknown>> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = 'icons'`).bind().first<{ value: string }>();
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Every slot's icon for a page. */
export async function readIcons(db: Db): Promise<Record<string, string>> {
  return resolveIcons(await stored(db));
}

/** Chooses a slot's icon (null puts the default back). False when the slot or icon is not known. */
export async function saveIcon(db: Db, slot: string, name: string | null, actorId: string, now = Date.now()): Promise<boolean> {
  if (!isSlot(slot) || (name !== null && !isIconName(name))) return false;
  const cur = await stored(db);
  const next: Record<string, string> = {};
  for (const s of ICON_SLOTS) if (s.id !== slot && isIconName(cur[s.id]) && cur[s.id] !== s.default) next[s.id] = cur[s.id] as string;
  if (name !== null && name !== SLOTS.get(slot)!.default) next[slot] = name;
  await db
    .prepare(`INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('icons', ?1, ?2, ?3)
              ON CONFLICT (key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3`)
    .bind(JSON.stringify(next), actorId, now)
    .run();
  await audit(db, { actorId, action: name === null ? "icons.reset" : "icons.choose", entity: "setting", entityId: "icons", detail: { slot, name: name ?? "default" } }, now);
  return true;
}

/** "chart-column" in words for the page: "Chart column". Pure. */
export const iconWords = (name: string) => (name.charAt(0).toUpperCase() + name.slice(1)).replace(/-/g, " ");
