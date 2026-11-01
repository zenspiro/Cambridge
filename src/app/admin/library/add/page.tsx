import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { DOC_TYPE_LABELS, LIBRARY, SESSION_LABELS } from "@/lib/config";
import { parseCambridgeName } from "@/lib/library/names";
import { LIST_SITES } from "@/lib/library/queries";
import { REASON_LABELS } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Add a file" };

const MESSAGES: Record<string, string> = {
  ...REASON_LABELS,
  none: "Choose a file first.",
  too_big: `Files can be up to ${LIBRARY.maxFileBytes / 1024 / 1024} MB.`,
  busy: "Too many uploads this hour. Please wait a little.",
  link: "That is not a full https link to a file.",
  not_approved: "That link is not on a switched-on approved source. Add the website on the Sources page first, if it may be used.",
  robots: "That website's robots.txt does not allow fetching this file.",
  fetch: "The file could not be fetched from that link.",
};

export default async function AddPage({ searchParams }: { searchParams: Promise<{ file?: string; e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const p = parseCambridgeName(q.file ?? "");
  if (!p) redirect("/admin/library");
  const env = await getEnv();
  const [existing, { results: sites }] = await Promise.all([
    env.DB.prepare(`SELECT id FROM source_document WHERE file_name = ?1 AND status = 'stored'`).bind(p.fileName).first<{ id: string }>(),
    env.DB.prepare(LIST_SITES).all<{ id: string; name: string; base_url: string; enabled: number }>(),
  ]);
  const what = [
    p.session === "y" ? `Syllabus ${p.year} version` : `${SESSION_LABELS[p.session]} ${p.year}`,
    DOC_TYPE_LABELS[p.docType],
    p.paper ? `paper ${p.paper}${p.variant ? `, variant ${p.variant}` : ""}` : "",
  ].filter(Boolean).join(", ");
  const back = `/admin/library/${p.code}`;

  return (
    <AdminShell current="/admin/library" title="Add a file">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link className="link" href="/admin/library">Library</Link>
        <span aria-hidden="true">›</span>
        <Link className="link" href={back}>{p.code}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">Add</span>
      </nav>
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />

      <section className="card stack">
        <h2 className="subtitle">{what}</h2>
        <p className="mono">{p.fileName}</p>
        {existing ? (
          <p className="notice">
            Already in the library. <a className="link" href={`/admin/library/file/${encodeURIComponent(existing.id)}`}>Download it</a>.
          </p>
        ) : null}
      </section>

      {!existing ? (
        <>
          <form className="card stack" method="post" action="/admin/library/add/upload" encType="multipart/form-data">
            <h2 className="subtitle">Upload from your computer</h2>
            <p className="muted">Any file name is fine: it is saved as {p.fileName}. PDF only, up to {LIBRARY.maxFileBytes / 1024 / 1024} MB.</p>
            <input type="hidden" name="target" value={p.fileName} />
            <label className="sr-only" htmlFor="file">PDF file</label>
            <input className="input" id="file" name="file" type="file" accept=".pdf,application/pdf" required />
            <button className="btn btn-primary btn-block" type="submit">Upload</button>
          </form>

          <form className="card stack" method="post" action="/admin/library/add/link">
            <h2 className="subtitle">Or paste a link</h2>
            <p className="muted">
              The link must be on a switched-on approved source:{" "}
              {sites.filter((s) => s.enabled).map((s) => s.name).join(", ") || "none yet"}. Manage them on{" "}
              <Link className="link" href="/admin/sources">Sources</Link>. The site fetches it once and checks it is a PDF.
            </p>
            <input type="hidden" name="target" value={p.fileName} />
            <label className="sr-only" htmlFor="url">Link to the PDF</label>
            <input className="input" id="url" name="url" type="url" required maxLength={500} placeholder="https://..." />
            <button className="btn btn-block" type="submit">Fetch from link</button>
          </form>
        </>
      ) : null}
      <p><Link className="link" href={back}>Back to {p.code}</Link></p>
    </AdminShell>
  );
}
