// Finding a subject's files on a website with no start page for it (owner, 11 Nov 2026: "the whole reason to build
// a system is not to use the manual links"). The agent starts at the site's address and follows its own menus:
// pages for the subject's qualification ("IGCSE"), then pages naming the subject's code ("igcse-biology-0610"), then
// pages naming the code and one of the run's years ("igcse-biology-0610-2025-oct-nov"), which list the files. Pure:
// the agent fetches (robots.txt, waits) and this decides what to follow. Shared with the unit tests.

/** Every link on a page as an absolute address, honouring the page's own <base href>. */
export function pageLinks(html: string, pageUrl: string): string[] {
  let base = pageUrl;
  const b = /<base\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html);
  if (b) {
    try {
      base = new URL((b[1] ?? b[2] ?? "").replace(/&amp;/g, "&").trim(), pageUrl).toString();
    } catch {
      // a broken base: the page's own address
    }
  }
  const out = new Set<string>();
  const re = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? m[2] ?? "").replace(/&amp;/g, "&").trim();
    if (!raw || raw.length > 600 || /^(javascript|mailto|tel|data):/i.test(raw)) continue;
    try {
      const u = new URL(raw, base);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      u.hash = "";
      out.add(u.toString());
    } catch {
      // not an address
    }
  }
  return [...out];
}

/**
 * The PDF a link stands for: the link itself when its path ends in .pdf, or a PDF address carried inside it
 * ("download_file.php?files=https://.../0610_w25_qp_42.pdf"). Null for anything else.
 */
export function pdfOf(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (/\.pdf$/i.test(u.pathname)) return u.toString();
  for (const v of u.searchParams.values()) {
    if (!/^https?:\/\//i.test(v)) continue;
    try {
      const inner = new URL(v);
      if (/\.pdf$/i.test(inner.pathname)) {
        inner.hash = "";
        return inner.toString();
      }
    } catch {
      // not an address
    }
  }
  return null;
}

/** Within the site: same origin and under its address. */
export function onSite(link: string, baseUrl: string): boolean {
  try {
    const u = new URL(link);
    const b = new URL(baseUrl);
    return u.origin === b.origin && u.pathname.startsWith(b.pathname);
  } catch {
    return false;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type CrawlScope = { code: string; years: readonly number[]; qualification: string };
export type LinkKind = "session" | "subject" | "qualification" | "file" | "other" | "outside";

/**
 * What a link on the site is for this run. session: names the code and a year of the run (its files are listed
 * there); subject: names the code and no year; outside: names the code with only years outside the run, or names
 * the qualification beside another code; qualification: names the qualification ("igcse") and no code at all;
 * file: one file's own page ("...-0610-s26-qp-42-pdf", a viewer: the session page links the file itself), never
 * followed. Topical pages ("igcse-biology-0610-topical-past-papers") are "other": never followed.
 * The code is matched as a whole number, so 0610 is not found in 20610.
 */
export function linkKind(link: string, s: CrawlScope): LinkKind {
  let path: string;
  try {
    const u = new URL(link);
    path = decodeURIComponent(u.pathname + u.search).toLowerCase();
  } catch {
    return "other";
  }
  // One file's viewer page ("...-0610-s26-qp-42-pdf", "...-enzymes-igcse-0610-biology-pdf"): the session page
  // links the files themselves, so these are never read.
  if (/[-_.]pdf\/?$/.test(path.split("?")[0]!)) return "file";
  // Topical pages (owner, 12 Nov 2026): questions cut out of papers and sorted by topic, not Cambridge's own files.
  // They are never followed, so the run's page budget goes on the session pages.
  if (/(^|[^a-z])(topical|topic-?wise|by-topics?)([^a-z]|$)/.test(path)) return "other";
  const codeRe = new RegExp(`(^|[^0-9])${s.code}(?![0-9])`);
  if (codeRe.test(path)) {
    if (new RegExp(`(^|[^0-9])${s.code}[-_][fmsjwy]\\d{2}[-_][a-z]{2}([-_.]|$)`).test(path)) return "file";
    const rest = path.replace(new RegExp(`(^|[^0-9])${s.code}(?![0-9])`, "g"), "$1");
    const years = [...rest.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g)].map((m) => Number(m[1]));
    if (!years.length) return "subject";
    return years.some((y) => s.years.includes(y)) ? "session" : "outside";
  }
  const q = slug(s.qualification);
  if (q && new RegExp(`(^|[^a-z])${q}([^a-z]|$)`).test(path)) {
    // A page for one subject of the qualification ("igcse-chemistry-0620") is another subject's.
    return /(^|[^0-9])\d{4}(?![0-9])/.test(path.replace(/(?:19|20)\d{2}/g, "")) ? "outside" : "qualification";
  }
  return "other";
}

/** How far the agent goes on one site in one run. */
export const CRAWL = { maxPages: 60, maxQualificationPages: 4, maxSubjectPages: 4 } as const;
