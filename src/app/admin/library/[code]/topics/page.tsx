import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { Crumbs } from "@/components/LibraryTables";
import { TreeStatusLine } from "@/components/TopicTree";
import { loadHeader } from "@/lib/library/catalog";
import { isActive, treesForCode } from "@/lib/brain/runs";
import { estimateWords, topicsCostCheck, usdWords } from "@/lib/brain/spend";
import { RunProgress } from "@/components/RunProgress";

const TOPIC_STAGES = ["pdf", "gemini", "claude", "retry", "checks", "save"] as const;

export const metadata: Metadata = { title: "Topic tree" };

const MESSAGES = {
  ok_started: "Started. Claude and Gemini are reading the syllabus; this takes a few minutes. The page updates by itself.",
  running: "A topic tree run is already going. Wait for it to finish.",
  no_pdf: "The syllabus PDF for this version is not in the library yet. Add it first.",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
  bad: "That did not work. Please reload the page and try again.",
  over_cap: "Not started: this run would take this month past your spending cap. Raise the cap on the AI setup page, or wait for next month.",
  no_price: "Not started: a spending cap is set, but a model in use has no price, so the cost cannot be checked. Add the price on the AI setup page.",
};

export default async function TopicsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const { code } = await params;
  const q = await searchParams;
  if (!/^\d{4}$/.test(code)) redirect("/admin/library");
  const env = await getEnv();
  const [header, rows] = await Promise.all([loadHeader(env.DB, code), treesForCode(env.DB, code)]);
  if (!header || !rows.length) redirect("/admin/library?e=unknown");
  const now = Date.now();
  // Rough cost per version with a PDF (a handful of reads; the versions of one code are few).
  const costs = new Map(await Promise.all(rows.filter((r) => r.pdf).map(async (r) => [r.syllabusId, await topicsCostCheck(env.DB, env, r.pdfBytes, now)] as const)));

  return (
    <AdminShell current="/admin/library" title={`Topic tree: ${header.subject_name} ${code}`}>
      <Crumbs items={[
        { label: "Library", href: "/admin/library" },
        { label: header.qualification_name },
        { label: `${header.subject_name} ${code}`, href: `/admin/library/${code}` },
        { label: "Topic tree" },
      ]} />
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <p className="muted">
        Claude copies each syllabus&apos;s topics and learning goals. Code checks every word against the syllabus PDF and the numbering, and
        Gemini copies it separately to compare. A tree goes live only when every check passes. Nothing here needs a subject expert.
      </p>
      {rows.map((r) => {
        const label = `Syllabus ${r.fromYear} to ${r.toYear}`;
        const running = isActive(r.run);
        return (
          <section className="card stack" key={r.syllabusId} id={`tree-${r.fromYear}`}>
            <h2 className="subtitle">{label}</h2>
            <TreeStatusLine row={r} now={now} />
            {running && r.run ? <RunProgress runId={r.run.id} stages={TOPIC_STAGES} /> : null}
            {r.pdf ? (
              <div className="row-actions">
                {r.status !== "none" ? (
                  <Link className="btn btn-small" href={`/admin/library/${code}/topics/${r.fromYear}`}>Open the tree</Link>
                ) : null}
                {!running ? (
                  <ActionForm className="inline-form" action={`/admin/library/${code}/topics/draft`} messages={MESSAGES}
                    confirm={r.status === "none" ? undefined : "Draft this tree again? The current one stays until the new one is saved."}>
                    <input type="hidden" name="syllabus" value={r.syllabusId} />
                    <button className="btn btn-small" type="submit">{r.status === "none" ? "Draft topic tree" : "Redraft"}</button>
                  </ActionForm>
                ) : null}
                {!running && costs.get(r.syllabusId) ? <CostLine c={costs.get(r.syllabusId)!} /> : null}
              </div>
            ) : (
              <p className="muted">
                The syllabus PDF is not in the library yet, so there is nothing to read.{" "}
                <Link className="link" href={`/admin/library/${code}/version/${r.fromYear}`}>Add it on the version page</Link>.
              </p>
            )}
          </section>
        );
      })}
    </AdminShell>
  );
}

function CostLine({ c }: { c: Awaited<ReturnType<typeof topicsCostCheck>> }) {
  return (
    <p className={c.verdict === "ok" ? "muted cost-line" : "alert cost-line"}>
      {estimateWords(c.estimate)}
      {c.cap > 0 ? ` This month: ${usdWords(c.spent)} of your ${usdWords(c.cap)} cap.` : ""}
      {c.verdict === "over_cap" ? " This run would go past the cap, so it will not start." : c.verdict === "no_price" ? " With a cap set, runs need a price for every model in use." : ""}
    </p>
  );
}
