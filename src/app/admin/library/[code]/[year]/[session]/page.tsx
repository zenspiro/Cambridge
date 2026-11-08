import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { StatusLine } from "@/components/LibraryBits";
import { DocChips, Legend, PaperTable } from "@/components/LibraryTables";
import { PAPER_TYPES } from "@/lib/library/map";
import { loadHeader, loadSyllabus } from "@/lib/library/catalog";
import { loadPapers } from "@/lib/library/papers";
import { sessionFromSlug, sessionHref } from "@/lib/library/slugs";
import type { Cell } from "@/lib/library/checklist";
import { ScoreBadge } from "@/components/ScoreBadge";
import { rowScore } from "@/lib/brain/paperRead";

export const metadata: Metadata = { title: "Exam session" };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; year: string; session: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  await requireAdmin();
  const { code, year, session } = await params;
  const q = await searchParams;
  const s = sessionFromSlug(session);
  if (!/^\d{4}$/.test(year) || !s) notFound();
  const env = await getEnv();
  const [list, header, { papers }] = await Promise.all([loadSyllabus(env.DB, code), loadHeader(env.DB, code), loadPapers(env.DB, code)]);
  if (!list || !header) redirect("/admin/library?e=unknown");
  const i = list.sessions.findIndex((g) => g.year === Number(year) && g.session === s);
  if (i < 0) redirect(`/admin/library/${code}`);
  const g = list.sessions[i]!;
  const newer = list.sessions[i - 1];
  const older = list.sessions[i + 1];
  const names = new Map(papers.filter((p) => p.syllabus_id === g.versionId).map((p) => [p.paper, p]));
  const main = g.rows.filter((r) => !r.series);
  const essential = main.filter((r) => r.essential);
  const extras = main.filter((r) => !r.essential);
  const ofSeries = (code: string) => (c: { fileName: string }) => c.fileName.startsWith(`${code}_`);
  const mainDocs = g.docs.filter((c) => !g.series.some((x) => ofSeries(x.code)(c)));
  // Question papers and mark schemes held for this session, each with a Review button and whether it was read
  // (owner, 7 Nov 2026: the ticks open the review screen, but a plain button is clearer).
  const toRead = [...essential, ...extras].flatMap((r) => (["qp", "ms"] as const).flatMap((t) => {
    const c = r.cells[t];
    return c?.doc ? [{ row: r, cell: c as Cell & { doc: NonNullable<Cell["doc"]> } }] : [];
  }));
  const readRows = toRead.length
    ? (await env.DB.prepare(`SELECT doc_id, items, flags, read_at, override_at, first_items, first_clean, first_red FROM paper_read WHERE doc_id IN (${toRead.map((_, k) => `?${k + 1}`).join(", ")})`)
      .bind(...toRead.map((x) => x.cell.doc.id)).all<{ doc_id: string; items: number; flags: string; read_at: number | null; override_at: number | null; first_items: number | null; first_clean: number | null; first_red: number | null }>()).results
    : [];
  const readState = new Map(readRows.map((r) => [r.doc_id, r]));

  return (
    <AdminShell
      current="/admin/library"
      title={g.label}
      crumbs={[
        { label: "Library", href: "/admin/library" },
        { label: header.qualification_name },
        { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` },
        { label: g.label },
      ]}
      actions={
        <nav className="page-actions" aria-label="Other sessions">
          {older ? <Link className="btn" href={sessionHref(code, older.year, older.session)}>‹ {older.label}</Link> : null}
          {newer ? <Link className="btn" href={sessionHref(code, newer.year, newer.session)}>{newer.label} ›</Link> : null}
          <Link className="btn btn-primary" href={`/admin/library/folder?code=${code}`}>Upload a folder</Link>
        </nav>
      }
    >
      <Notice code={q.e} messages={{ ok_added: "File added to the library." }} />

      <section className="card stack">
        <StatusLine status={g.status} />
        <h2 className="label-inline">For the whole session</h2>
        <DocChips cells={mainDocs} />
      </section>

      {toRead.length ? (
        <section className="card stack" id="to-review">
          <h2 className="subtitle">Read and review</h2>
          <ul className="review-list">
            {toRead.map(({ row, cell }) => {
              const st = readState.get(cell.doc.id);
              const words = !st?.read_at ? "Not read" : st.override_at ? "Read, marked ready" : "Read";
              return (
                <li key={cell.doc.id} className="review-list-row">
                  <span>Paper {row.paper}{row.variant !== null ? `, variant ${row.variant}` : ""}: {cell.docType === "qp" ? "question paper" : "mark scheme"}{row.essential ? "" : " (extra)"}</span>
                  <span className={`pill${st?.read_at ? " pill-ok" : ""}`}>{words}</span>
                  {st ? <ScoreBadge score={rowScore(st)} /> : <span />}
                  {/* A full page load: the review page's own security policy frames the PDF. */}
                  <a className="btn btn-small" href={`/admin/library/review/${encodeURIComponent(cell.doc.id)}`}>Review</a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="card stack">
        <h2 className="subtitle">Essential: variant {[...new Set(essential.map((r) => r.variant))].join(", ")}</h2>
        <PaperTable rows={essential} types={PAPER_TYPES} papers={names} />
      </section>

      {extras.length > 0 ? (
        <details className="card group">
          <summary className="group-head">
            <span className="subtitle">Other variants (extras)</span>
            <span className="pill">{extras.reduce((n, r) => n + Object.values(r.cells).filter((c) => c?.doc).length, 0)} stored</span>
          </summary>
          <div className="group-body">
            <PaperTable rows={extras} types={PAPER_TYPES} papers={names} />
          </div>
        </details>
      ) : null}
      {g.series.map((x) => (
        <section className="card stack" key={x.code} id={`series-${x.code}`}>
          <h2 className="subtitle">{x.label}</h2>
          <p className="muted">The same papers, set by Cambridge under its own code for this series.</p>
          <DocChips cells={g.docs.filter(ofSeries(x.code))} />
          <PaperTable rows={g.rows.filter((r) => r.series === x.code)} types={PAPER_TYPES} papers={names} />
        </section>
      ))}
      <Legend />
    </AdminShell>
  );
}
