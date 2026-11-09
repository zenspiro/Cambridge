import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allowed, staffForDoc } from "@/lib/auth/staff";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { docTypeLabel } from "@/lib/config";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { describeFile, loadPapers, paperLookup } from "@/lib/library/papers";
import { dateFmt, formatBytes, sessionLabel } from "@/lib/library/labels";
import { loadReviewDoc, relatedDocs } from "@/lib/library/review";
import { sessionHref, versionHref, type ExamSession } from "@/lib/library/slugs";
import { ActionForm } from "@/components/ActionForm";
import { PaperReview } from "@/components/PaperReview";
import { ScoreBadge } from "@/components/ScoreBadge";
import { RunProgress } from "@/components/RunProgress";
import { loadPages, PAPER_KINDS, paperDoc, paperView, type PaperView } from "@/lib/brain/paperRead";
import { isActive, runState } from "@/lib/brain/runs";
import { modelName } from "@/lib/brain/labels";
import { estimateWords, paperCostCheck, usdWords, type CostCheck } from "@/lib/brain/spend";
import type { PaperKind } from "@/lib/brain/paper";

export const metadata: Metadata = { title: "Review" };

const ORIGIN = { upload: "Uploaded", agent: "Fetched by the agent", link: "Added from a link" } as const;

// The review screen (owner, 6 Nov 2026): the PDF as stored on the left, what the database holds on the right.
// Links to a review page are plain <a> (a full load), so its own CSP (frame-src 'self') applies.
// Step 2a: the file and the files that belong with it. Step 2b adds the paper rebuilt from the database, with flags.
const MESSAGES = {
  ok_started: "Started. Progress shows below.",
  ok_ready: "Marked ready, with the remaining flags recorded as ignored.",
  ok_undone: "Undone.",
  running: "A brain run is already going. Wait for it to finish.",
  over_cap: "Not started: this run would take this month past your spending cap. Raise the cap on the AI setup page, or wait for next month.",
  no_price: "Not started: a spending cap is set, but a model in use has no price, so the cost cannot be checked. Add the price on the AI setup page.",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
  bad: "That did not work. Please reload the page and try again.",
};

const FIX_WORDS: Record<string, string> = {
  pdf: "Used the PDF's version", edit: "Edited", fine: "It's fine", looks_right: "Looks right", override: "Marked ready anyway",
};
const PAPER_STAGES = ["pdf", "gemini", "claude", "figures", "checks", "save"] as const;
const RECENT_MS = 15 * 60_000;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) notFound();
  // The owner, or a team member who may view this file's subject. Fixes need source review edit; reading (paid runs)
  // stays with the owner (owner, 9 Nov 2026).
  const access = await staffForDoc(id);
  if (!access) redirect("/admin?e=no_access");
  const canFix = allowed(access.staff, { area: "sourceReview", level: "edit", code: access.code });
  const canRead = access.staff.owner;
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
  // Question papers and mark schemes are read by the brain (step 2b) and rebuilt beside the PDF.
  const isPaper = PAPER_KINDS.includes(doc.docType as PaperKind);
  const info = isPaper ? await paperDoc(env.DB, doc.id) : null;
  const view = info ? await paperView(env.DB, env.FILES, info) : null;
  const [pageCount, run, cost] = view ? await Promise.all([
    view.content ? loadPages(env.FILES, doc.id).then((p) => p.length) : Promise.resolve(0),
    view.row?.jobId ? runState(env.DB, view.row.jobId) : Promise.resolve(null),
    paperCostCheck(env.DB, env, doc.bytes),
  ]) : [0, null, null];
  const busy = isActive(run);
  const facts = (
    <dl className="facts">
      <dt>What it is</dt><dd>{title}</dd>
      <dt>Subject</dt><dd>{subject}</dd>
      <dt>File</dt><dd className="mono">{doc.fileName}</dd>
      <dt>Size</dt><dd>{formatBytes(doc.bytes)}</dd>
      <dt>Added</dt><dd>{ORIGIN[doc.origin]}{doc.siteName ? ` from ${doc.siteName}` : host ? ` from ${host}` : ""}, {dateFmt.format(doc.acquiredAt)}</dd>
    </dl>
  );

  return (
    <AdminShell
      current="/admin/library"
      title={title}
      keepHead={false}
      crumbs={[{ label: "Library", href: "/admin/library" }, { label: subject, href: `/admin/library/${doc.code}` }, where, { label: "Review" }]}
      actions={<>
        <a className="btn" href={pdf} target="_blank" rel="noopener">Open the PDF in a new tab</a>
        <a className="btn" href={`/admin/library/file/${encodeURIComponent(doc.id)}`}>Download</a>
      </>}
    >
      <div className="review-bar">
        {related.paper.length > 0 ? (
          <nav className="review-switch" aria-label="Files of the same paper">
            <span className="review-switch-item" aria-current="page">{docTypeLabel(doc.docType)}</span>
            {related.paper.map((r) => (
              <a key={r.id} className="review-switch-item" href={`/admin/library/review/${encodeURIComponent(r.id)}`}>{docTypeLabel(r.docType)}</a>
            ))}
          </nav>
        ) : <span />}
      </div>
      {view && cost ? <ReadingCard docId={doc.id} view={view} cost={cost} run={run} busy={busy} facts={facts} canFix={canFix} canRead={canRead} /> : null}
      {view?.content ? (
        <PaperReview
          docId={doc.id}
          pdfUrl={pdf}
          kind={doc.docType as PaperKind}
          items={view.content.items}
          figures={view.content.figures.map((f) => ({ id: f.id, page: f.page, caption: f.caption, description: f.description, shown: !!f.box || !!f.svg, cut: f.cut }))}
          flags={view.open}
          pageCount={pageCount}
          revision={view.row?.revision ?? 0}
          busy={busy}
          canFix={canFix}
          canRead={canRead}
        />
      ) : (
      <div className="review">
        <section className="review-pane" aria-label="The PDF as stored">
          <h2 className="review-head">The PDF as stored</h2>
          <iframe className="review-pdf" src={pdf} title={`${doc.fileName}, the PDF as stored`} />
        </section>
        <section className="review-pane" aria-label="What we hold">
          <h2 className="review-head">What we hold</h2>
          <div className="review-body stack-tight">
            {facts}
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
            ) : isPaper ? (
              <p className="notice">Not read yet. Press Read this paper above: the paper rebuilt from our database, with flags on anything that differs, appears here.</p>
            ) : (
              <p className="muted">Examiner reports and grade thresholds are read in the next part of step 2.</p>
            )}
          </div>
        </section>
      </div>
      )}
    </AdminShell>
  );
}

/** The paper's reading: its state, Read this paper (with the rough cost), ready anyway, live progress and recent fixes. */
function ReadingCard({ docId, view, cost, run, busy, facts, canFix, canRead }: {
  docId: string; view: PaperView; cost: CostCheck; run: Awaited<ReturnType<typeof runState>>; busy: boolean; facts: React.ReactNode; canFix: boolean; canRead: boolean;
}) {
  const base = `/admin/library/review/${encodeURIComponent(docId)}`;
  const read = !!view.content;
  const override = !!view.row?.overrideAt;
  const cutAgain = (view.content?.figures ?? []).filter((f) => f.cut !== "manual").map((f) => f.id).slice(0, 50);
  const pill = !read ? <span className="pill">Not read</span>
    : view.open.length === 0 ? <span className="pill pill-ok">Ready</span>
      : override ? <span className="pill pill-ok">Ready (marked ready)</span>
        : <span className="pill pill-gap">{view.open.length} flag{view.open.length === 1 ? "" : "s"} open</span>;
  return (
    <section className="card stack" id="reading">
      <div className="reading-head">
        <h2 className="subtitle">Reading</h2>
        {pill}
        <ScoreBadge score={view.row?.score ?? null} long />
        {read ? <span className="muted">{view.content!.items.length} items, {view.content!.figures.length} figures{view.row?.readAt ? `, read ${dateFmt.format(view.row.readAt)}` : ""}</span> : null}
      </div>
      {/* Live while it runs; afterwards the steps stay for a while (or until the next run), and a stopped run says why. */}
      {run && (busy || run.status === "failed" || (run.finishedAt !== null && Date.now() - run.finishedAt < RECENT_MS)) ? <RunProgress runId={run.id} stages={PAPER_STAGES} /> : null}
      <div className="row-actions">
        {!busy && canRead ? (
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes, proceed" no="No"
            confirm={`${read ? "Read the paper again? Confirmed items stay; flagged and missing ones are read again." : "Read this paper?"} This uses AI tokens: ${cost.estimate.usd === null ? "cost unknown" : `about ${usdWords(cost.estimate.usd)}`}. Proceed?`}>
            <button className="btn btn-primary" type="submit">{read ? "Read it again" : "Read this paper"}</button>
          </ActionForm>
        ) : null}
        {/* Free (owner, 7 Nov 2026): cuts every figure again from the PDF with no AI; words, fixes and hand-drawn boxes stay. */}
        {!busy && canRead && cutAgain.length ? (
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes, proceed" no="No"
            confirm={`Cut ${cutAgain.length} figure${cutAgain.length === 1 ? "" : "s"} again from the PDF? No AI is used, so it costs nothing; boxes you drew by hand stay. Proceed?`}>
            {cutAgain.map((id) => <input key={id} type="hidden" name="figure" value={id} />)}
            <button className="btn" type="submit">Cut figures from the PDF (free)</button>
          </ActionForm>
        ) : null}
        {canFix && read && view.open.length > 0 && !override ? (
          <ActionForm action={`${base}/fix`} messages={MESSAGES} confirm={`Mark it ready with ${view.open.length} flag${view.open.length === 1 ? "" : "s"} still open? They are recorded as ignored.`}>
            <input type="hidden" name="action" value="override" />
            <button className="btn" type="submit">Mark ready anyway</button>
          </ActionForm>
        ) : null}
        {override && canFix ? (
          <ActionForm action={`${base}/fix`} messages={MESSAGES}>
            <input type="hidden" name="action" value="unoverride" />
            <button className="btn btn-small" type="submit">Take back ready</button>
          </ActionForm>
        ) : null}
      </div>
      {!busy && canRead ? (
        <p className={cost.verdict === "ok" ? "muted" : "alert"}>
          {estimateWords(cost.estimate)}
          {cost.cap > 0 ? ` This month: ${usdWords(cost.spent)} of your ${usdWords(cost.cap)} cap.` : ""}
          {cost.verdict === "over_cap" ? " This would go past the cap, so it will not start." : cost.verdict === "no_price" ? " With a cap set, runs need a price for every model in use." : ""}
        </p>
      ) : null}
      {/* One score per full reading with the models that read it (owner, 8 Nov 2026: compare a cheaper Claude). */}
      {view.row?.scores.length ? (
        <div className="stack-tight">
          <h3 className="label-inline">Read accuracy of each reading</h3>
          <ul className="score-list">
            {[...view.row.scores].reverse().map((s) => (
              <li key={s.at}>
                <ScoreBadge score={s.score} />{" "}
                <span>{s.claude ? modelName(s.claude) : "Claude"}{s.gemini ? `, checked by ${modelName(s.gemini)}` : ""}</span>{" "}
                <span className="muted">{dateFmt.format(s.at)}, {s.score.clean} of {s.score.items} parts with no flag</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.fixes.length ? (
        <details>
          <summary className="link">Fixes on this paper ({view.fixes.length})</summary>
          <ul className="list-plain fix-list">
            {view.fixes.map((f) => (
              <li key={f.id}>
                {FIX_WORDS[f.action] ?? f.action}{f.item ? ` (${f.item})` : ""}, {dateFmt.format(f.at)}
                {f.undone ? <span className="muted"> (undone)</span> : !canFix ? null : (
                  <ActionForm className="inline-form fix-undo" action={`${base}/fix`} messages={MESSAGES}>
                    <input type="hidden" name="action" value="undo" />
                    <input type="hidden" name="fix" value={f.id} />
                    <button className="btn btn-small" type="submit">Undo</button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details>
        <summary className="link">About this file</summary>
        {facts}
      </details>
    </section>
  );
}
