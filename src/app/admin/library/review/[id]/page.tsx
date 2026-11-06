import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { Crumbs } from "@/components/LibraryTables";
import { docTypeLabel } from "@/lib/config";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { describeFile, loadPapers, paperLookup } from "@/lib/library/papers";
import { dateFmt, formatBytes, sessionLabel } from "@/lib/library/labels";
import { loadReviewDoc, relatedDocs } from "@/lib/library/review";
import { sessionHref, versionHref, type ExamSession } from "@/lib/library/slugs";

export const metadata: Metadata = { title: "Review" };

const ORIGIN = { upload: "Uploaded", agent: "Fetched by the agent", link: "Added from a link" } as const;

// The review screen (owner, 6 Nov 2026): the PDF as stored on the left, what the database holds on the right.
// Links to a review page are plain <a> (a full load), so its own CSP (frame-src 'self') applies.
// Step 2a: the file and the files that belong with it. Step 2b adds the paper rebuilt from the database, with flags.
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) notFound();
  const env = await getEnv();
  const doc = await loadReviewDoc(env.DB, id);
  if (!doc) notFound();
  const [{ papers }, subjects, related] = await Promise.all([loadPapers(env.DB, doc.code), listSubjects(env.DB), relatedDocs(env.DB, doc)]);
  const lookup = paperLookup(papers);
  const title = describeFile(doc.fileName, doc.syllabusId, lookup);
  const subject = subjectLabel(subjects, doc.code);
  const where = doc.session === "y" ? { label: `Syllabus ${doc.fromYear} to ${doc.toYear}`, href: versionHref(doc.code, doc.fromYear) }
    : { label: sessionLabel(doc.session, doc.year), href: sessionHref(doc.code, doc.year, doc.session as ExamSession) };
  const pdf = `/admin/library/file/${encodeURIComponent(doc.id)}/view`;
  const host = doc.sourceUrl ? new URL(doc.sourceUrl).hostname : null;

  return (
    <AdminShell current="/admin/library" title={title}>
      <Crumbs items={[{ label: "Library", href: "/admin/library" }, { label: subject, href: `/admin/library/${doc.code}` }, where, { label: "Review" }]} />
      <div className="review-bar">
        {related.paper.length > 0 ? (
          <nav className="review-switch" aria-label="Files of the same paper">
            <span className="review-switch-item" aria-current="page">{docTypeLabel(doc.docType)}</span>
            {related.paper.map((r) => (
              <a key={r.id} className="review-switch-item" href={`/admin/library/review/${encodeURIComponent(r.id)}`}>{docTypeLabel(r.docType)}</a>
            ))}
          </nav>
        ) : <span />}
        <div className="row-actions">
          <a className="btn btn-small" href={pdf} target="_blank" rel="noopener">Open the PDF in a new tab</a>
          <a className="btn btn-small" href={`/admin/library/file/${encodeURIComponent(doc.id)}`}>Download</a>
        </div>
      </div>
      <div className="review">
        <section className="review-pane" aria-label="The PDF as stored">
          <h2 className="review-head">The PDF as stored</h2>
          <iframe className="review-pdf" src={pdf} title={`${doc.fileName}, the PDF as stored`} />
        </section>
        <section className="review-pane" aria-label="What we hold">
          <h2 className="review-head">What we hold</h2>
          <div className="review-body stack-tight">
            <dl className="facts">
              <dt>What it is</dt><dd>{title}</dd>
              <dt>Subject</dt><dd>{subject}</dd>
              <dt>File</dt><dd className="mono">{doc.fileName}</dd>
              <dt>Size</dt><dd>{formatBytes(doc.bytes)}</dd>
              <dt>Added</dt><dd>{ORIGIN[doc.origin]}{doc.siteName ? ` from ${doc.siteName}` : host ? ` from ${host}` : ""}, {dateFmt.format(doc.acquiredAt)}</dd>
            </dl>
            {related.session.length > 0 ? (
              <>
                <h3 className="label-inline">{doc.docType === "er" || doc.docType === "gt" ? "Question papers of this session" : "This session"}</h3>
                <ul className="list-plain">
                  {related.session.map((r) => (
                    <li key={r.id}><a className="link" href={`/admin/library/review/${encodeURIComponent(r.id)}`}>{describeFile(r.fileName, doc.syllabusId, lookup)}</a></li>
                  ))}
                </ul>
              </>
            ) : null}
            {doc.docType === "sy" ? (
              <p className="muted">This syllabus&apos;s topics and goals are on its <Link className="link" href={`/admin/library/${doc.code}/topics/${doc.fromYear}`}>topic tree</Link>.</p>
            ) : (
              <p className="notice">
                The paper rebuilt from our database, with flags on anything that differs, appears here once papers are read (the next part of step 2).
              </p>
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
