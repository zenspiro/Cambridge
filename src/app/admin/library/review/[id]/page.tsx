import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allowed, staffForDoc, ADMIN_EDIT } from "@/lib/auth/staff";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { AdminShell, FreeTag } from "@/components/AdminShell";
import { docTypeLabel, SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { describeFile, loadPapers, paperLookup } from "@/lib/library/papers";
import { dateFmt, formatBytes, sessionLabel } from "@/lib/library/labels";
import { loadReviewDoc, relatedDocs } from "@/lib/library/review";
import { sessionHref, versionHref, type ExamSession } from "@/lib/library/slugs";
import { ActionForm } from "@/components/ActionForm";
import { PaperReview } from "@/components/PaperReview";
import { ScoreBadge } from "@/components/ScoreBadge";
import { RunProgress } from "@/components/RunProgress";
import { BackLink } from "@/components/BackLink";
import { loadPages, markedReviewed, PAPER_KINDS, paperDoc, paperView, readByClaudeAlone, type PaperView } from "@/lib/brain/paperRead";
import { personName } from "@/lib/library/documents";
import { isActive, runState } from "@/lib/brain/runs";
import { modelName } from "@/lib/brain/labels";
import { estimateWords, readerChoices, usdWords, type ReaderChoice } from "@/lib/brain/spend";
import type { PaperKind } from "@/lib/brain/paper";

const CUT_TIP = "Uses no AI credits: our own code cuts the figures from the PDF.";
export const metadata: Metadata = { title: "Review" };

const ORIGIN = { upload: "Uploaded", agent: "Fetched by the agent", link: "Added from a link" } as const;

// The review screen (owner, 6 Nov 2026): the PDF as stored on the left, what the database holds on the right.
// Links to a review page are plain <a> (a full load), so its own CSP (frame-src 'self') applies.
// Step 2a: the file and the files that belong with it. Step 2b adds the paper rebuilt from the database, with flags.
const MESSAGES = {
  ok_started: "Started. Progress shows below.",
  ok_ready: "Marked ready, with the remaining flags recorded as ignored.",
  ok_undone: "Undone.",
  ok_reviewed: "Marked as reviewed.",
  ok_unreviewed: "Taken back: it shows as not checked by a person again.",
  running: "A brain run is already going. Wait for it to finish.",
  over_cap: "Not started: this run would take this month past your spending cap. Raise the cap on the AI setup page, or wait for next month.",
  no_price: "Not started: a spending cap is set, but a model in use has no price, so the cost cannot be checked. Add the price on the AI setup page.",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
  bad: "That did not work. Please reload the page and try again.",
  // Move or remove this file (owner, 12 Nov 2026).
  ok_moved: "Moved. The file now sits in the session you picked.",
  ok_removed: "Removed from the library.",
  same_place: "It is in that session already.",
  same_name: "That session already has this file. Remove that one first, then move this one.",
  year: "That year is outside the library years.",
  no_syllabus: "No syllabus version covers that session.",
  name: "This file cannot be moved: its name has no exam session (a specimen or syllabus file).",
  gone: "This file is no longer in the library.",
  file_busy: "An AI run is reading this file. Wait for it to finish first.",
  storage: "The file could not be copied in storage. Please try again.",
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
  // Paid reading (owner, 9 Nov 2026): the owner, or the whole admin to edit, inside the monthly cap.
  const canRead = allowed(access.staff, ADMIN_EDIT);
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
  const [pageCount, run, choices] = view ? await Promise.all([
    view.content ? loadPages(env.FILES, doc.id).then((p) => p.length) : Promise.resolve(0),
    view.row?.jobId ? runState(env.DB, view.row.jobId) : Promise.resolve(null),
    readerChoices(env.DB, env, doc.bytes),
  ]) : [0, null, null];
  const busy = isActive(run);
  // Who marked it reviewed, by name (a team member's from their account).
  const reviewer = view?.row?.reviewedBy
    ? personName(view.row.reviewedBy, view.row.reviewedBy.startsWith("team:")
      ? (await env.DB.prepare(`SELECT name FROM "auth_user" WHERE id = ?1`).bind(view.row.reviewedBy.slice(5)).first<{ name: string }>())?.name ?? null
      : null)
    : "";
  const facts = (
    <dl className="facts">
      <dt>What it is</dt><dd>{title}</dd>
      <dt>Subject</dt><dd>{subject}</dd>
      <dt>File</dt><dd className="mono">{doc.fileName}</dd>
      <dt>Size</dt><dd>{formatBytes(doc.bytes)}</dd>
      <dt>Added</dt><dd>{ORIGIN[doc.origin]}{doc.siteName ? ` from ${doc.siteName}` : host ? ` from ${host}` : ""}, {dateFmt.format(doc.acquiredAt)}</dd>
    </dl>
  );
  // Move or remove this file (owner, 12 Nov 2026: a file uploaded under the wrong month could not be put right).
  const years = canRead ? libraryYears(await getLibrarySettings(env.DB)).sort((a, b) => b - a) : [];
  const fileTools = canRead ? (
    <details className="file-tools" id="file-tools">
      <summary className="link">Move or remove this file</summary>
      <div className="stack-tight">
        {doc.session !== "y" ? (
          <ActionForm className="form-actions" action={`/admin/library/review/${encodeURIComponent(doc.id)}/file`} messages={MESSAGES} yes="Yes" no="No" confirm="Move this file to that session?">
            <input type="hidden" name="do" value="move" />
            <label className="field">
              <span className="label-inline">Month</span>
              <select className="input" name="session" defaultValue={doc.session}>
                {(["m", "s", "w"] as const).map((s) => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label-inline">Year</span>
              <select className="input" name="year" defaultValue={String(doc.year)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <button className="btn" type="submit">Move here</button>
          </ActionForm>
        ) : null}
        <p className="hint m-0">Moving keeps the type, paper and variant; only the session changes. Its readings stay with it.</p>
        <ActionForm action={`/admin/library/review/${encodeURIComponent(doc.id)}/file`} messages={MESSAGES} yes="Yes, remove" no="No" follow
          confirm="Remove this file and its readings?">
          <input type="hidden" name="do" value="remove" />
          <button className="btn btn-danger" type="submit">Remove from the library</button>
        </ActionForm>
      </div>
    </details>
  ) : null;

  return (
    <AdminShell
      current="/admin/library"
      title={title}
      keepHead={false}
      crumbs={[{ label: "Library", href: "/admin/library" }, { label: subject, href: `/admin/library/${doc.code}` }, where, { label: "Review" }]}
      actions={<>
        <BackLink fallback={`/admin/library/${doc.code}/documents`} fallbackLabel="← Documents" />
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
      {view && choices?.length ? <ReadingCard docId={doc.id} view={view} choices={choices} run={run} busy={busy} facts={<>{facts}{fileTools}</>} canFix={canFix} canRead={canRead} reviewer={reviewer} /> : null}
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
          fixes={view.fixes}
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
            {fileTools}
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
function ReadingCard({ docId, view, choices, run, busy, facts, canFix, canRead, reviewer }: {
  docId: string; view: PaperView; choices: ReaderChoice[]; run: Awaited<ReturnType<typeof runState>>; busy: boolean; facts: React.ReactNode; canFix: boolean; canRead: boolean; reviewer: string;
}) {
  const base = `/admin/library/review/${encodeURIComponent(docId)}`;
  const read = !!view.content;
  // The saved Reading AI's rough cost leads; "Read with" offers the others for this reading only (owner, 9 Nov 2026).
  const cost = choices[0]!.check;
  const override = !!view.row?.overrideAt;
  const cutAgain = (view.content?.figures ?? []).filter((f) => f.cut !== "manual").map((f) => f.id).slice(0, 50);
  // Mark as reviewed (owner, 10 Nov 2026): no flags left and a person says they checked it; a new full reading undoes it.
  const marked = !!view.row && markedReviewed(view.row);
  const pill = !read ? <span className="pill">Not read</span>
    : view.open.length === 0 && marked ? <span className="pill pill-ok">Reviewed</span>
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
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes" no="No"
            confirm={`${read ? "Read it again" : "Read this paper"}? Uses AI credits: the cost is beside the AI you picked.`}>
            <span className="read-with">
              <label className="label-inline" htmlFor="read-with">Read with</label>
              <select className="input" id="read-with" name="reader" defaultValue="">
                {choices.map((c) => (
                  <option key={c.value || "saved"} value={c.value} disabled={c.check.verdict === "over_cap"}>
                    {c.label}: {c.check.estimate.usd === null ? "price not set" : `about ${usdWords(c.check.estimate.usd)}`}{c.check.verdict === "over_cap" ? " (past the cap)" : ""}
                  </option>
                ))}
              </select>
            </span>
            <button className="btn btn-primary" type="submit">{read ? "Read it again" : "Read this paper"}</button>
          </ActionForm>
        ) : null}
        {/* Run the checks again (owner, 9 Nov 2026): no AI; the reading as it stands, fixes included, checked with today's
            checks, so new flags show before anything is paid for. Figures with no box are cut too. */}
        {!busy && canRead && read ? (
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes" no="No" confirm="Run the checks again? Free.">
            <input type="hidden" name="check" value="1" />
            <button className="btn" type="submit">Run the checks again <FreeTag /></button>
          </ActionForm>
        ) : null}
        {/* Check with Gemini (owner, 12 Nov 2026): the last reading was Claude's alone (Gemini could not help); Gemini
            reads it now, free, and the checks compare the two. */}
        {!busy && canRead && read && view.row && readByClaudeAlone(view.row.scores) ? (
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes" no="No" confirm="Check with Gemini? Free.">
            <input type="hidden" name="second" value="1" />
            <button className="btn" type="submit">Check with Gemini <FreeTag tip="Uses no paid AI credits: Gemini (free) reads the paper and our checks compare it with Claude's reading." /></button>
          </ActionForm>
        ) : null}
        {/* No AI (owner, 7 Nov 2026): cuts every figure again from the PDF with no AI; words, fixes and hand-drawn boxes stay. */}
        {!busy && canRead && cutAgain.length ? (
          <ActionForm action={`${base}/read`} messages={MESSAGES} yes="Yes" no="No"
            confirm={`Cut ${cutAgain.length} figure${cutAgain.length === 1 ? "" : "s"} again? Free. Hand-drawn boxes stay.`}>
            {cutAgain.map((id) => <input key={id} type="hidden" name="figure" value={id} />)}
            <button className="btn" type="submit">Cut figures again <FreeTag tip={CUT_TIP} /></button>
          </ActionForm>
        ) : null}
        {canFix && read && view.open.length > 0 && !override ? (
          <ActionForm action={`${base}/fix`} messages={MESSAGES} confirm={`Mark it ready with ${view.open.length} flag${view.open.length === 1 ? "" : "s"} open?`}>
            <input type="hidden" name="action" value="override" />
            <button className="btn" type="submit">Mark ready anyway</button>
          </ActionForm>
        ) : null}
        {canFix && read && view.open.length === 0 && !marked ? (
          <ActionForm action={`${base}/fix`} messages={MESSAGES} yes="Yes, mark it" no="No"
            confirm="Checked against the PDF? Mark it reviewed.">
            <input type="hidden" name="action" value="review" />
            <button className="btn btn-primary" type="submit">Mark as reviewed</button>
          </ActionForm>
        ) : null}
        {canFix && marked ? (
          <ActionForm action={`${base}/fix`} messages={MESSAGES}>
            <input type="hidden" name="action" value="unreview" />
            <button className="btn btn-small" type="submit">Take back reviewed</button>
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
          {estimateWords(cost.estimate)}{choices.length > 1 ? " Pick another AI in Read with for this reading only; your Reading AI on AI setup stays as it is." : ""}
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
                <span>{s.session ? "Read in a dev session" : s.claude ? `${modelName(s.claude)}${s.gemini ? `, checked by ${modelName(s.gemini)}${s.checkedLater ? " later" : ""}` : " alone (Gemini could not help)"}` : s.gemini ? `${modelName(s.gemini)} alone` : "Claude"}</span>{" "}
                <span className="muted">{dateFmt.format(s.at)}, {s.score.clean} of {s.score.items} parts with no flag</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {marked && view.row?.reviewedAt ? <p className="m-0">Reviewed by {reviewer}, {dateFmt.format(view.row.reviewedAt)}.</p> : null}
      {view.fixes.length ? <p className="muted m-0">{view.fixes.length} change{view.fixes.length === 1 ? "" : "s"} on this paper: see Changes beside the flags, each with a link to where it was made.</p> : null}
      <details>
        <summary className="link">About this file</summary>
        {facts}
      </details>
    </section>
  );
}
