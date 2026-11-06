import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { Crumbs } from "@/components/LibraryTables";
import { TreeStatusLine, TreeView } from "@/components/TopicTree";
import { BRAIN } from "@/lib/config";
import { loadHeader } from "@/lib/library/catalog";
import { isActive, loadTree, treesForCode } from "@/lib/brain/runs";
import { PROBLEM_WORDS } from "@/lib/brain/labels";
import { buildTree, flaggedGoals } from "@/lib/brain/topics";

export const metadata: Metadata = { title: "Topic tree" };

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export default async function TreePage({ params }: { params: Promise<{ code: string; from: string }> }) {
  await requireAdmin();
  const { code, from } = await params;
  if (!/^\d{4}$/.test(code) || !/^\d{4}$/.test(from)) notFound();
  const env = await getEnv();
  const [header, rows] = await Promise.all([loadHeader(env.DB, code), treesForCode(env.DB, code)]);
  const row = rows.find((r) => r.fromYear === Number(from));
  if (!header || !row) redirect(`/admin/library/${code}/topics`);
  const stored = await loadTree(env.DB, row.syllabusId);
  if (!stored) redirect(`/admin/library/${code}/topics`);
  const { draft, report } = stored;
  const tree = buildTree(draft, flaggedGoals(report));
  const label = `Syllabus ${row.fromYear} to ${row.toYear}`;
  const core = draft.goals.filter((g) => g.tier === "core").length;
  const supp = draft.goals.filter((g) => g.tier === "supplement").length;

  return (
    <AdminShell current="/admin/library" title={`Topic tree: ${header.subject_name} ${code}, ${row.fromYear} to ${row.toYear}`}>
      {isActive(row.run) ? <meta httpEquiv="refresh" content={String(BRAIN.refreshSeconds)} /> : null}
      <Crumbs items={[
        { label: "Library", href: "/admin/library" },
        { label: header.qualification_name },
        { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` },
        { label: "Topic tree", href: `/admin/library/${code}/topics` },
        { label },
      ]} />
      <section className="card stack">
        <TreeStatusLine row={row} now={Date.now()} />
        <h2 className="subtitle">Checks</h2>
        <ul className="list-plain">
          <li>
            {report.textChecked
              ? report.problems.some((p) => p.kind === "words") ? "Word check: some wording was not found in the syllabus (listed below)." : "Word check: every title, goal and note was found in the syllabus PDF."
              : "Word check: the syllabus PDF's text could not be read, so this tree cannot be marked ready."}
          </li>
          <li>{report.problems.some((p) => p.kind === "numbers" || p.kind === "missing") ? "Numbering: some numbers or headings need another look (listed below)." : "Numbering: whole, with no gaps, repeats or missing headings."}</li>
          <li>
            Second reader (Gemini): agrees on {pct(report.agreement)} (ready needs {pct(BRAIN.minAgreement)})
            {report.settled > 0 ? `; ${report.settled} differences were settled by the syllabus text in Claude's favour` : ""}.
          </li>
          <li>{core} Core goals, {supp} Supplement goals{draft.goals.length - core - supp > 0 ? `, ${draft.goals.length - core - supp} for all candidates` : ""}. Claude drafted it {report.attempts === 1 ? "in one try" : `in ${report.attempts} tries`}.</li>
        </ul>
        {report.problems.length > 0 ? (
          <details className="group">
            <summary className="label-inline">{report.problems.length} {report.problems.length === 1 ? "check" : "checks"} still open</summary>
            <ul className="list-plain">
              {report.problems.map((p, i) => (
                <li key={i}><strong>{PROBLEM_WORDS[p.kind]}</strong>: {p.where}. <span className="muted">{p.detail}</span></li>
              ))}
            </ul>
          </details>
        ) : null}
        {report.disagreements.length > 0 ? (
          <details className="group">
            <summary className="label-inline">{report.disagreements.length} {report.disagreements.length === 1 ? "difference" : "differences"} between Claude and Gemini</summary>
            <ul className="list-plain">
              {report.disagreements.map((d, i) => (
                <li key={i}><strong>{d.where}</strong>: Claude: {d.claude} <span className="muted">Gemini: {d.gemini}</span></li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="muted">
          Models: {report.models.claude || "Claude"} and {report.models.gemini || "Gemini"}. <Link className="link" href={`/admin/library/${code}/topics`}>Back to the topic trees</Link>
        </p>
      </section>
      <section className="card stack">
        <h2 className="subtitle">{draft.topics.length} topics, {draft.goals.length} learning goals</h2>
        <TreeView nodes={tree} />
      </section>
    </AdminShell>
  );
}
