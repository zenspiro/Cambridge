// Fetch one PDF from a link the admin pasted. Only from an enabled approved source,
// https only, robots.txt obeyed, redirects only within the same site, size capped.
// (The Worker also has global_fetch_strictly_public, so private addresses are refused.)
import { AGENT, LIBRARY } from "../config.ts";
import type { Db } from "../db.ts";
import { parseRobots } from "../agent/robots.ts";

export type LinkResult =
  | { ok: true; bytes: Uint8Array; siteId: string; url: string }
  | { ok: false; reason: "link" | "not_approved" | "robots" | "fetch" | "size" };

export async function fetchApprovedPdf(db: Db, raw: unknown, fetcher: typeof fetch = fetch): Promise<LinkResult> {
  if (typeof raw !== "string" || raw.length > 500) return { ok: false, reason: "link" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "link" };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return { ok: false, reason: "link" };
  url.hash = "";
  const { results: sites } = await db
    .prepare(`SELECT id, base_url FROM source_site WHERE enabled = 1`)
    .bind()
    .all<{ id: string; base_url: string }>();
  const site = sites.find((s) => url.toString().startsWith(s.base_url));
  if (!site) return { ok: false, reason: "not_approved" };

  const ua = `${AGENT.userAgentToken}/1.0`;
  try {
    const robots = await fetcher(`${url.origin}/robots.txt`, { headers: { "User-Agent": ua }, redirect: "manual" });
    if (robots.status >= 500) return { ok: false, reason: "robots" };
    if (robots.ok && !parseRobots(await robots.text(), AGENT.userAgentToken)(url.pathname)) return { ok: false, reason: "robots" };

    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetcher(current, { headers: { "User-Agent": ua }, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current);
        if (next.origin !== current.origin || !next.toString().startsWith(site.base_url)) return { ok: false, reason: "not_approved" };
        current = next;
        continue;
      }
      if (res.status !== 200 || !res.body) return { ok: false, reason: "fetch" };
      if (Number(res.headers.get("content-length") ?? "0") > LIBRARY.maxFileBytes) return { ok: false, reason: "size" };
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > LIBRARY.maxFileBytes) {
          await reader.cancel();
          return { ok: false, reason: "size" };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let o = 0;
      for (const c of chunks) {
        bytes.set(c, o);
        o += c.length;
      }
      return { ok: true, bytes, siteId: site.id, url: current.toString() };
    }
    return { ok: false, reason: "fetch" };
  } catch {
    return { ok: false, reason: "fetch" };
  }
}
