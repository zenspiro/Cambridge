// Brand settings (owner, 5 Nov 2026): platform name, short name, description, footer statement, default theme and
// the logo, square logo and favicon are set at /admin/brand, never in code. Stored in the `setting` row 'brand';
// images live in the FILES bucket under brand/ and are served by /brand/[file]. No Next imports (unit tested).
import type { Bucket, Db } from "./db.ts";
import { audit } from "./auth/session.ts";
import { BRAND, THEMES, type BrandImageKind, type ThemeId } from "./config.ts";

export type BrandImage = { file: string; type: string; bytes: number };
export type Brand = {
  name: string;
  shortName: string;
  description: string;
  /** Footer statement; "{name}" is replaced with the platform name. */
  footer: string;
  defaultTheme: ThemeId;
  images: Partial<Record<BrandImageKind, BrandImage>>;
};

export const IMAGE_KINDS = Object.keys(BRAND.imageKinds) as BrandImageKind[];

/** Used for anything missing, so pages never break. The name falls back to the APP_NAME var. */
export function brandDefaults(fallbackName: string): Brand {
  return {
    name: fallbackName,
    shortName: fallbackName.slice(0, BRAND.maxShortNameLength),
    description: "Practice, marking and progress for Cambridge exam students.",
    footer: "{name} is independent and is not affiliated with or endorsed by Cambridge University Press & Assessment.",
    defaultTheme: THEMES[0].id,
    images: {},
  };
}

/** Allowed image types by their first bytes (owner decision: no SVG, which can carry scripts). */
const IMAGE_TYPES: ReadonlyArray<{ type: string; ext: string; test: (b: Uint8Array) => boolean }> = [
  { type: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

/** The image's type from its bytes, or null when it is not a PNG, JPEG or WebP. */
export function imageType(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes.length < 12) return null;
  const t = IMAGE_TYPES.find((x) => x.test(bytes));
  return t ? { type: t.type, ext: t.ext } : null;
}

const FILE_RE = /^(logo|square|favicon)-[0-9a-f]{16}\.(png|jpg|webp)$/;

/** A stored image file name ("logo-0123456789abcdef.png"): kind plus a hash, so each upload has a new address. */
export const isBrandFile = (f: string): boolean => FILE_RE.test(f);
export const brandKey = (file: string): string => `brand/${file}`;
export const brandUrl = (img: BrandImage): string => `/brand/${img.file}`;

/** Single-line text, trimmed, inner whitespace collapsed; null when too long. Control characters are refused. */
function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

function checkImage(v: unknown, kind: BrandImageKind): BrandImage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.file !== "string" || !isBrandFile(o.file) || !o.file.startsWith(`${kind}-`)) return null;
  if (!IMAGE_TYPES.some((t) => t.type === o.type)) return null;
  if (typeof o.bytes !== "number" || !Number.isInteger(o.bytes) || o.bytes < 1 || o.bytes > BRAND.maxImageBytes) return null;
  return { file: o.file, type: o.type as string, bytes: o.bytes };
}

/** The text fields from a form or the database; null when any is invalid. Empty name and short name are refused. */
export function checkBrandText(v: unknown): Omit<Brand, "images"> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = line(o.name, BRAND.maxNameLength);
  const shortName = line(o.shortName, BRAND.maxShortNameLength);
  const description = line(o.description, BRAND.maxDescriptionLength);
  const footer = line(o.footer, BRAND.maxFooterLength);
  const theme = THEMES.find((t) => t.id === o.defaultTheme)?.id;
  if (!name || !shortName || description === null || footer === null || !theme) return null;
  return { name, shortName, description, footer, defaultTheme: theme };
}

/** A whole stored value read safely: bad parts fall back to the defaults one by one. */
export function readBrand(raw: unknown, fallbackName: string): Brand {
  const d = brandDefaults(fallbackName);
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const text = checkBrandText({ ...d, ...o }) ?? d;
  const imgs = (o.images && typeof o.images === "object" ? o.images : {}) as Record<string, unknown>;
  const images: Brand["images"] = {};
  for (const k of IMAGE_KINDS) {
    const img = checkImage(imgs[k], k);
    if (img) images[k] = img;
  }
  return { ...text, images };
}

/** The footer statement with the platform name filled in. */
export const footerText = (b: Brand): string => b.footer.replaceAll("{name}", b.name);

export async function getBrand(db: Db, fallbackName: string): Promise<Brand> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = 'brand'`).bind().first<{ value: string }>();
  try {
    return readBrand(row ? JSON.parse(row.value) : null, fallbackName);
  } catch {
    return brandDefaults(fallbackName);
  }
}

async function write(db: Db, value: Brand, actorId: string, action: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('brand', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3`,
    )
    .bind(JSON.stringify(value), actorId, now)
    .run();
  await audit(db, { actorId, action, entity: "setting", entityId: "brand" }, now);
}

export async function saveBrandText(db: Db, text: Omit<Brand, "images">, fallbackName: string, actorId: string, now = Date.now()) {
  const current = await getBrand(db, fallbackName);
  await write(db, { ...current, ...text }, actorId, "brand.text", now);
}

async function hashHex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type ImageResult = "ok_image" | "bad_type" | "too_big" | "empty";

/** Checks and stores one brand image, replaces the old file of that kind (deleted after the new one is saved). */
export async function saveBrandImage(
  db: Db,
  bucket: Bucket,
  kind: BrandImageKind,
  bytes: Uint8Array,
  fallbackName: string,
  actorId: string,
  now = Date.now(),
): Promise<ImageResult> {
  if (bytes.length === 0) return "empty";
  if (bytes.length > BRAND.maxImageBytes) return "too_big";
  const t = imageType(bytes);
  if (!t) return "bad_type";
  const file = `${kind}-${(await hashHex(bytes)).slice(0, 16)}.${t.ext}`;
  await bucket.put(brandKey(file), bytes, { httpMetadata: { contentType: t.type } });
  const current = await getBrand(db, fallbackName);
  const old = current.images[kind];
  await write(db, { ...current, images: { ...current.images, [kind]: { file, type: t.type, bytes: bytes.length } } }, actorId, `brand.${kind}`, now);
  if (old && old.file !== file) await bucket.delete(brandKey(old.file));
  return "ok_image";
}

/** Takes one image away, so the default (the platform name as text, no icon) shows again. */
export async function removeBrandImage(db: Db, bucket: Bucket, kind: BrandImageKind, fallbackName: string, actorId: string, now = Date.now()) {
  const current = await getBrand(db, fallbackName);
  const old = current.images[kind];
  if (!old) return;
  const images = { ...current.images };
  delete images[kind];
  await write(db, { ...current, images }, actorId, `brand.${kind}.remove`, now);
  await bucket.delete(brandKey(old.file));
}

/** Which current image a public file name belongs to, if any (old files are never served). */
export function findBrandImage(b: Brand, file: string): BrandImage | null {
  if (!isBrandFile(file)) return null;
  return Object.values(b.images).find((i) => i?.file === file) ?? null;
}

/** What a student or parent page frame needs: names, picture addresses and the finished footer statement. */
export function frameBrand(b: Brand): { name: string; logoUrl?: string; squareUrl?: string; footer: string } {
  return {
    name: b.name,
    logoUrl: b.images.logo ? brandUrl(b.images.logo) : undefined,
    squareUrl: b.images.square ? brandUrl(b.images.square) : undefined,
    footer: footerText(b),
  };
}
