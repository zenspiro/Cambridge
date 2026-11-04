// Google Drive, read only, through Google's official Drive API v3 with an API key.
// Works for folders shared as "anyone with the link". The key travels in a header,
// never in a URL, so it cannot end up in logs. Requests are paced.
export type DriveItem = { id: string; name: string; mimeType: string; size?: string; shortcutDetails?: { targetId: string; targetMimeType: string } };
// Plain fields, no constructor shorthand: Node runs this file by stripping types only.
export class DriveError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string) {
    super(`Google Drive answered ${status}${reason ? ` (${reason})` : ""}`);
    this.status = status;
    this.reason = reason;
  }
}

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

export function makeDrive(opts: { key: string; base: string; delayMs: number }) {
  let last = 0;
  async function call(path: string, params: Record<string, string>, raw = false, maxBytes = 0): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const wait = last + opts.delayMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const url = `${opts.base}${path}?${new URLSearchParams({ supportsAllDrives: "true", ...params })}`;
      const res = await fetch(url, { headers: { "X-Goog-Api-Key": opts.key }, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || (res.status === 403 && attempt < 2 && (await peekReason(res.clone())).includes("rate"))) {
        if (attempt >= 2) throw new DriveError(res.status, "rate limited");
        await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1))); // back off, then try again
        continue;
      }
      if (!res.ok) throw new DriveError(res.status, await peekReason(res));
      if (!raw) return res.json();
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (maxBytes && declared > maxBytes) throw new DriveError(413, "file too big");
      const buf = new Uint8Array(await res.arrayBuffer());
      if (maxBytes && buf.length > maxBytes) throw new DriveError(413, "file too big");
      return buf;
    }
  }

  return {
    async folder(id: string): Promise<{ id: string; name: string; mimeType: string }> {
      return (await call(`/files/${encodeURIComponent(id)}`, { fields: "id,name,mimeType" })) as DriveItem;
    },
    async children(id: string): Promise<DriveItem[]> {
      const out: DriveItem[] = [];
      let pageToken = "";
      for (let page = 0; page < 50; page++) {
        const r = (await call("/files", {
          q: `'${id.replace(/'/g, "")}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,size,shortcutDetails(targetId,targetMimeType))",
          pageSize: "1000",
          includeItemsFromAllDrives: "true",
          ...(pageToken ? { pageToken } : {}),
        })) as { files?: DriveItem[]; nextPageToken?: string };
        out.push(...(r.files ?? []));
        if (!r.nextPageToken) break;
        pageToken = r.nextPageToken;
      }
      return out;
    },
    async download(id: string, maxBytes: number): Promise<Uint8Array> {
      return (await call(`/files/${encodeURIComponent(id)}`, { alt: "media", acknowledgeAbuse: "false" }, true, maxBytes)) as Uint8Array;
    },
  };
}

export type Drive = ReturnType<typeof makeDrive>;

/**
 * What a Drive refusal means, as a reason code for the run report. "quota" and "rate" are
 * Google limiting downloads (busy shared files, or too many in a row); they pass with time.
 */
export function driveRefusal(e: DriveError): "drive_quota" | "drive_rate" | "drive_forbidden" | "drive_missing" | "drive_too_big" | "drive_error" {
  const r = e.reason.toLowerCase();
  if (e.status === 413) return "drive_too_big";
  if (e.status === 404) return "drive_missing";
  if (/quota/.test(r)) return "drive_quota";
  if (e.status === 429 || /rate|limit/.test(r)) return "drive_rate";
  if (e.status === 403) return "drive_forbidden";
  return "drive_error";
}
export const isFolder = (i: DriveItem) => i.mimeType === FOLDER || (i.mimeType === SHORTCUT && i.shortcutDetails?.targetMimeType === FOLDER);
export const targetId = (i: DriveItem) => (i.mimeType === SHORTCUT ? i.shortcutDetails?.targetId ?? i.id : i.id);
export const isPdfItem = (i: DriveItem) =>
  i.mimeType === "application/pdf" || (i.mimeType === SHORTCUT && i.shortcutDetails?.targetMimeType === "application/pdf") || /\.pdf$/i.test(i.name);

async function peekReason(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    return String(j.error?.errors?.[0]?.reason ?? j.error?.status ?? "").slice(0, 60);
  } catch {
    return "";
  }
}

/** Walks a folder tree breadth first, with caps. Yields each PDF with its folder path. */
export async function walk(
  drive: Drive,
  rootId: string,
  limits: { maxFolders: number; maxDepth: number },
  onFolder?: (path: string[], n: number) => Promise<void>,
  /** Which subfolders of one folder to open (true) or skip (false). Default: all. */
  choose?: (path: string[], names: string[]) => Promise<boolean[]>,
): Promise<{ root: string; pdfs: { item: DriveItem; path: string[] }[]; folders: number; truncated: boolean; others: number; skipped: number }> {
  const root = await drive.folder(rootId);
  const queue: { id: string; path: string[]; depth: number }[] = [{ id: rootId, path: [root.name], depth: 0 }];
  const seen = new Set<string>([rootId]);
  const pdfs: { item: DriveItem; path: string[] }[] = [];
  let folders = 0;
  let others = 0;
  let skipped = 0;
  let truncated = false;
  while (queue.length) {
    const f = queue.shift()!;
    if (folders >= limits.maxFolders) {
      truncated = true;
      break;
    }
    folders++;
    if (onFolder) await onFolder(f.path, folders);
    const items = await drive.children(f.id);
    const subs = items.filter((i) => isFolder(i) && !seen.has(targetId(i)) && f.depth + 1 <= limits.maxDepth);
    const keep = choose && subs.length ? await choose(f.path, subs.map((i) => i.name)) : subs.map(() => true);
    subs.forEach((item, i) => {
      const id = targetId(item);
      seen.add(id);
      if (keep[i] === false) skipped++;
      else queue.push({ id, path: [...f.path, item.name], depth: f.depth + 1 });
    });
    for (const item of items) {
      if (isFolder(item)) continue;
      if (isPdfItem(item)) pdfs.push({ item, path: f.path });
      else others++;
    }
  }
  return { root: root.name, pdfs, folders, truncated, others, skipped };
}
