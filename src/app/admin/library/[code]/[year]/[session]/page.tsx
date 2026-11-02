import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { StatusLine } from "@/components/LibraryBits";
import { Crumbs, DocChips, Legend, PaperTable } from "@/components/LibraryTables";
import { loadHeader, loadSyllabus } from "@/lib/library/catalog";
import { loadPapers } from "@/lib/library/papers";
import { sessionFromSlug, sessionHref } from "@/lib/library/slugs";

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
  const essential = g.rows.filter((r) => r.essential);
  const extras = g.rows.filter((r) => !r.essential);

  return (
    <AdminShell current="/admin/library" title={g.label}>
      <Crumbs items={[
        { label: "Library", href: "/admin/library" },
        { label: header.qualification_name },
        { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` },
        { label: g.label },
      ]} />
      <Notice code={q.e} messages={{ ok_added: "File added to the library." }} />
      <nav className="pager" aria-label="Other sessions">
        {older ? <Link className="btn btn-small" href={sessionHref(code, older.year, older.session)}>‹ {older.label}</Link> : <span />}
        {newer ? <Link className="btn btn-small" href={sessionHref(code, newer.year, newer.session)}>{newer.label} ›</Link> : <span />}
      </nav>

      <section className="card stack">
        <StatusLine status={g.status} />
        <h2 className="label-inline">For the whole session</h2>
        <DocChips cells={g.docs} />
      </section>

      <section className="card stack">
        <h2 className="subtitle">Essential: variant {[...new Set(essential.map((r) => r.variant))].join(", ")}</h2>
        <PaperTable rows={essential} types={["qp", "in", "ms", "ci"]} papers={names} />
      </section>

      {extras.length > 0 ? (
        <details className="card group">
          <summary className="group-head">
            <span className="subtitle">Other variants (extras)</span>
            <span className="pill">{extras.reduce((n, r) => n + Object.values(r.cells).filter((c) => c?.doc).length, 0)} stored</span>
          </summary>
          <div className="group-body">
            <PaperTable rows={extras} types={["qp", "in", "ms", "ci"]} papers={names} />
          </div>
        </details>
      ) : null}
      <Legend />
    </AdminShell>
  );
}
