import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { StatusLine } from "@/components/LibraryBits";
import { DocChips, Legend, PaperTable } from "@/components/LibraryTables";
import { loadHeader, loadSyllabus } from "@/lib/library/catalog";
import { loadPapers } from "@/lib/library/papers";

export const metadata: Metadata = { title: "Syllabus version" };

export default async function VersionPage({ params }: { params: Promise<{ code: string; from: string }> }) {
  await requireAdmin();
  const { code, from } = await params;
  if (!/^\d{4}$/.test(from)) notFound();
  const env = await getEnv();
  const [list, header, { papers }] = await Promise.all([loadSyllabus(env.DB, code), loadHeader(env.DB, code), loadPapers(env.DB, code)]);
  if (!list || !header) redirect("/admin/library?e=unknown");
  const g = list.versions.find((v) => v.version.valid_from_year === Number(from));
  if (!g) redirect(`/admin/library/${code}`);
  const names = new Map(papers.filter((p) => p.syllabus_id === g.version.id).map((p) => [p.paper, p]));
  const label = `Syllabus ${g.version.valid_from_year} to ${g.version.valid_to_year}`;

  return (
    <AdminShell
      current="/admin/library"
      title={label}
      crumbs={[
        { label: "Library", href: "/admin/library" },
        { label: header.qualification_name },
        { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` },
        { label },
      ]}
    >
      <section className="card stack">
        <StatusLine status={g.status} />
        <h2 className="label-inline">Syllabus documents</h2>
        <DocChips cells={g.docs} />
        {[...names.values()].some((p) => p.note) ? <p className="muted">{[...names.values()].find((p) => p.note)?.note}</p> : null}
      </section>
      {g.specimens.length > 0 ? (
        <section className="card stack">
          <h2 className="subtitle">Specimen papers</h2>
          <PaperTable rows={g.specimens} types={["sp", "sm", "ci"]} papers={names} />
        </section>
      ) : (
        <section className="card"><p className="muted">No specimens are asked for in this version.</p></section>
      )}
      <Legend />
    </AdminShell>
  );
}
