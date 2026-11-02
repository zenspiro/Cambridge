// Approved source websites (brief 3.8): validation and changes, all audited.
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import * as Q from "./queries.ts";
import { driveFolderId } from "../agent/classify.ts";

export type SiteError = "name" | "url" | "notes" | "exists";

/**
 * A source address must be a plain public https URL: no login details, no IP
 * addresses, no local names, no query or fragment. Returned in a normal form.
 */
export function normaliseSiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost") return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  return `https://${host}${path}`;
}

export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : null;
}

export async function addSite(
  db: Db,
  input: { name: unknown; url: unknown; notes: unknown },
  actorId: string,
  now = Date.now(),
): Promise<{ ok: true; id: string } | { ok: false; error: SiteError }> {
  const name = cleanText(input.name, 80);
  if (!name) return { ok: false, error: "name" };
  const url = normaliseSiteUrl(input.url);
  if (!url) return { ok: false, error: "url" };
  const notes = cleanText(input.notes ?? "", 300);
  if (notes === null) return { ok: false, error: "notes" };
  const row = await db.prepare(Q.INSERT_SITE).bind(randomId(), name, url, notes, actorId, now).first<{ id: string }>();
  if (!row) return { ok: false, error: "exists" };
  // drive.google.com itself is a Google Drive source: it holds folders, not start pages.
  if (url === DRIVE_BASE) await db.prepare(`UPDATE source_site SET kind = 'gdrive' WHERE id = ?1`).bind(row.id).run();
  await audit(db, { actorId, action: "source_site.add", entity: "source_site", entityId: row.id }, now);
  return { ok: true, id: row.id };
}

export async function setSiteEnabled(db: Db, id: string, enabled: boolean, actorId: string, now = Date.now()) {
  const site = await db.prepare(Q.GET_SITE).bind(id).first<{ id: string }>();
  if (!site) return false;
  await db.prepare(Q.SET_SITE_ENABLED).bind(id, enabled ? 1 : 0).run();
  await audit(db, { actorId, action: enabled ? "source_site.enable" : "source_site.disable", entity: "source_site", entityId: id }, now);
  return true;
}

export async function removeSite(db: Db, id: string, actorId: string, now = Date.now()) {
  const site = await db.prepare(Q.GET_SITE).bind(id).first<{ id: string }>();
  if (!site) return false;
  await db.prepare(Q.DELETE_SITE).bind(id).run();
  await audit(db, { actorId, action: "source_site.remove", entity: "source_site", entityId: id }, now);
  return true;
}

/** A start page must be a public https address inside its source's address. */
export function checkPageUrl(raw: unknown, siteBase: string): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  const site = normaliseSiteUrl(siteBase);
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!site || u.protocol !== "https:" || u.username || u.password || u.port) return null;
  u.hash = "";
  const out = u.toString();
  return out.startsWith(site) ? out : null;
}

export async function addPage(
  db: Db,
  input: { siteId: string; url: unknown; code: unknown },
  actorId: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: "missing" | "page_url" | "page_exists" | "code" }> {
  const site = await db.prepare(Q.GET_SITE).bind(input.siteId).first<{ id: string; base_url: string }>();
  if (!site) return { ok: false, error: "missing" };
  const code = typeof input.code === "string" ? input.code : "";
  const known = await db.prepare(`SELECT 1 AS x FROM syllabus WHERE code = ?1 LIMIT 1`).bind(code).first();
  if (!known) return { ok: false, error: "code" };
  const url = checkPageUrl(input.url, site.base_url);
  if (!url) return { ok: false, error: "page_url" };
  const row = await db
    .prepare(`INSERT INTO source_page (id, site_id, syllabus_code, url, created_by, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING RETURNING id`)
    .bind(randomId(), site.id, code, url, actorId, now)
    .first<{ id: string }>();
  if (!row) return { ok: false, error: "page_exists" };
  await audit(db, { actorId, action: "source_page.add", entity: "source_page", entityId: row.id }, now);
  return { ok: true };
}

export async function removePage(db: Db, id: string, actorId: string, now = Date.now()) {
  const row = await db.prepare(`DELETE FROM source_page WHERE id = ?1 RETURNING id`).bind(id).first<{ id: string }>();
  if (row) await audit(db, { actorId, action: "source_page.remove", entity: "source_page", entityId: id }, now);
  return !!row;
}

// Google Drive sources: a site whose address is drive.google.com holds shared folders.
export const DRIVE_BASE = "https://drive.google.com/";
const MAX_FOLDERS_PER_ADD = 50;

/** Adds every Drive folder link in the text (one per line). Duplicates and bad lines are counted, not stored. */
export async function addDriveFolders(db: Db, siteId: string, text: unknown, actorId: string, now = Date.now()) {
  const site = await db.prepare(`SELECT id, kind FROM source_site WHERE id = ?1`).bind(siteId).first<{ id: string; kind: string }>();
  if (!site || site.kind !== "gdrive") return { ok: false as const, error: "missing" as const };
  const lines = typeof text === "string" ? text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_FOLDERS_PER_ADD) : [];
  let added = 0, dupes = 0, bad = 0;
  for (const line of lines) {
    const id = driveFolderId(line);
    if (!id) { bad++; continue; }
    const row = await db
      .prepare(`INSERT INTO source_drive_folder (id, site_id, folder_id, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT DO NOTHING RETURNING id`)
      .bind(randomId(), site.id, id, actorId, now)
      .first<{ id: string }>();
    if (row) added++;
    else dupes++;
  }
  if (added) await audit(db, { actorId, action: "drive_folder.add", entity: "source_site", entityId: site.id, detail: { added } }, now);
  return { ok: true as const, added, dupes, bad };
}

export async function removeDriveFolder(db: Db, id: string, actorId: string, now = Date.now()) {
  const row = await db.prepare(`DELETE FROM source_drive_folder WHERE id = ?1 RETURNING id`).bind(id).first<{ id: string }>();
  if (row) await audit(db, { actorId, action: "drive_folder.remove", entity: "source_drive_folder", entityId: id }, now);
  return !!row;
}
