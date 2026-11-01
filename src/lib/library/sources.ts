// Approved source websites (brief 3.8): validation and changes, all audited.
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import * as Q from "./queries.ts";

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
