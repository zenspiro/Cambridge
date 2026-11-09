import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { recentAudit } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { AdminShell, Empty } from "@/components/AdminShell";
import { ScoreBadge } from "@/components/ScoreBadge";
import { COUNT_ALL_DOCUMENTS } from "@/lib/library/queries";
import { dateFmt } from "@/lib/library/labels";
import { describeFile, loadPapers, paperLookup } from "@/lib/library/papers";
import { activeRuns, activityWords, failedRuns, papersToReview, recentlyCleared } from "@/lib/adminStatus";
import { ActionForm } from "@/components/ActionForm";
import { sizeWords, storageStat } from "@/lib/storage";
import { STORAGE } from "@/lib/config";
import { rowScore } from "@/lib/brain/paperRead";
import { monthBounds, readCap, readPrices, spendBetween, usdWords } from "@/lib/brain/spend";

export const metadata: Metadata = { title: "Admin" };

const MESSAGES = {
  ok_cleared: "Cleared from Needs you. Cleared by mistake? Undo it under Cleared today.",
  ok_back: "Back in Needs you.",
  ok_counted: "Storage counted again.",
  gone: "That item was already sorted.",
  bad: "That could not be cleared. Please try again.",
  busy: "Too many changes this hour. Please wait a little.",
};

/** A Clear (or Undo) button for one Needs you item, in place, no reload. */
function ClearButton({ kind, id, undo = false, label }: { kind: "run" | "paper"; id: string; undo?: boolean; label: string }) {
  return (
    <ActionForm className="inline-form" action="/admin/home/clear" messages={MESSAGES}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {undo ? <input type="hidden" name="undo" value="1" /> : null}
      <button className="btn btn-small" type="submit" aria-label={label}>{undo ? "Undo" : "Clear"}</button>
    </ActionForm>
  );
}

/** Clear all of one section, asked inline first. */
function ClearAll({ kind, n }: { kind: "run" | "paper"; n: number }) {
  return (
    <ActionForm className="inline-form" action="/admin/home/clear" messages={MESSAGES} yes="Yes, clear" no="Never mind"
      confirm={`Clear all ${n} from Needs you? ${kind === "run" ? "The runs' pages keep their details." : "Their flags stay on the review screen; a paper comes back if it is read again."}`}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value="all" />
      <button className="btn btn-small" type="submit">Clear all</button>
    </ActionForm>
  );
}

/**
 * Home (owner, 8 Nov 2026: a functional admin): what needs the admin now, in one place. Runs that stopped, papers
 * with flags to review, the month's AI spend against the cap, then the latest activity in words.
 */
export default async function AdminHome() {
  await requireAdmin();
  const env = await getEnv();
  const db = env.DB;
  const month = monthBounds(undefined);
  const [events, count, running, failed, review, prices, cap, cleared, storage] = await Promise.all([
    recentAudit(db, 15),
    db.prepare(COUNT_ALL_DOCUMENTS).first<{ n: number; subjects: number }>(),
    activeRuns(db),
    failedRuns(db),
    papersToReview(db),
    readPrices(db),
    readCap(db),
    recentlyCleared(db),
    storageStat(db, env.FILES),
  ]);
  const files = storage.papers.bytes + storage.files.bytes;
  const spend = await spendBetween(db, month.from, month.to, prices);
  const codes = [...new Set([...review.list.map((r) => r.code), ...cleared.flatMap((c) => (c.code ? [c.code] : []))])];
  const lookups = new Map(await Promise.all(codes.map(async (c) => [c, paperLookup((await loadPapers(db, c)).papers)] as const)));
  const needs = failed.total + review.total;
  const words = (fileName: string, syllabusId: string, code: string) => describeFile(fileName, syllabusId, lookups.get(code) ?? paperLookup([]));

  return (
    <AdminShell
      current="/admin"
      title="Admin"
      intro="What needs you now: runs that stopped and papers with flags to review. Everything else is in the menu."
      actions={<>
        <Link className="btn btn-primary" href="/admin/library/folder">Upload a folder</Link>
        <Link className="btn" href="/admin/agent">Run the agent</Link>
      </>}
    >
      <div className="tiles" id="home-tiles">
        <Link className="tile-stat card-link" href="/admin/library">
          <span className="tile-stat-label">Source library</span>
          <span className="tile-stat-value">{count?.n ?? 0}</span>
          <span className="tile-stat-note">files stored, {count?.subjects ?? 0} subject{count?.subjects === 1 ? "" : "s"}</span>
        </Link>
        <a className="tile-stat card-link" href="#needs-you">
          <span className="tile-stat-label">Papers read</span>
          <span className="tile-stat-value">{review.read}</span>
          <span className="tile-stat-note">{review.total} with flags to review</span>
        </a>
        <Link className="tile-stat card-link" href="/admin/ai#usage">
          <span className="tile-stat-label">AI spend, {month.label}</span>
          <span className="tile-stat-value">{usdWords(spend.total)}</span>
          <span className="tile-stat-note">{cap > 0 ? `of your ${usdWords(cap)} cap` : "no monthly cap set"}{spend.unpriced.length ? `; ${spend.unpriced.length} model${spend.unpriced.length === 1 ? "" : "s"} without a price` : ""}</span>
        </Link>
        <div className="tile-stat">
          <span className="tile-stat-label">Running now</span>
          <span className="tile-stat-value">{running.length}</span>
          <span className="tile-stat-note">{running.length ? "listed in the sidebar, with links" : "nothing running"}</span>
        </div>
        {/* Storage (owner, 9 Nov 2026): database and buckets against Cloudflare's free allowances. */}
        <div className="tile-stat tile-wide" id="storage">
          <span className="tile-stat-label">Storage</span>
          <span className="tile-stat-value">{sizeWords((storage.db ?? 0) + files)}</span>
          <span className="tile-stat-note">
            Database {storage.db === null ? "size not reported" : `${sizeWords(storage.db)} of ${sizeWords(STORAGE.dbFreeBytes)} free`}.
            {" "}Files {sizeWords(files)}{storage.files.partial ? " or more" : ""} of {sizeWords(STORAGE.filesFreeBytes)} free:
            {" "}papers {sizeWords(storage.papers.bytes)} ({storage.papers.count}), app files {sizeWords(storage.files.bytes)} ({storage.files.count}).
          </span>
          <span className="tile-stat-foot">
            <span className="hint">Counted {dateFmt.format(storage.at)}; an estimate, Cloudflare&apos;s dashboard is the bill.</span>
            <ActionForm className="inline-form" action="/admin/home/storage" messages={MESSAGES}>
              <button className="btn btn-small" type="submit">Count again</button>
            </ActionForm>
          </span>
        </div>
      </div>

      <section className="card stack" id="needs-you">
        <div className="card-head">
          <h2 className="subtitle">Needs you</h2>
          {needs ? <span className="pill pill-warn">{needs} to look at</span> : <span className="pill pill-ok">All clear</span>}
        </div>
        {needs === 0 ? (
          <Empty title="Nothing needs you right now.">No run stopped in the last 7 days needs a look, and every paper read is ready or cleared.</Empty>
        ) : null}
        {failed.list.length ? (
          <div className="stack-tight">
            <div className="card-head">
              <h3 className="label-inline">Runs that stopped (last 7 days){failed.total > failed.list.length ? `: the newest ${failed.list.length} of ${failed.total}` : ""}</h3>
              <ClearAll kind="run" n={failed.total} />
            </div>
            <p className="hint m-0">A run that later succeeds at the same thing clears itself.</p>
            <ul className="list">
              {failed.list.map((r) => (
                <li className="need-row" key={r.id}>
                  <span className="need-text">
                    <span><span className="pill pill-bad">Stopped</span> {r.label} <span className="muted">{dateFmt.format(r.at)}</span></span>
                    <span className="hint">{r.why}</span>
                  </span>
                  <span className="row-actions">
                    <a className="btn btn-small" href={r.href}>See why</a>
                    <ClearButton kind="run" id={r.id} label={`Clear ${r.label}`} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {review.list.length ? (
          <div className="stack-tight">
            <div className="card-head">
              <h3 className="label-inline">Papers with flags to review{review.total > review.list.length ? ` (the ${review.list.length} with the most of ${review.total})` : ""}</h3>
              <ClearAll kind="paper" n={review.total} />
            </div>
            <ul className="list">
              {review.list.map((r) => (
                <li className="need-row" key={r.docId}>
                  <span>
                    {words(r.fileName, r.syllabusId, r.code)}{" "}
                    <ScoreBadge score={rowScore({ ...r.score, read_at: r.readAt })} />{" "}
                    <span className="muted">{r.open} flag{r.open === 1 ? "" : "s"} open</span>
                  </span>
                  {/* Plain link: the review screen needs its own page load for its PDF frame. */}
                  <span className="row-actions">
                    <a className="btn btn-small" href={`/admin/library/review/${encodeURIComponent(r.docId)}`}>Review</a>
                    <ClearButton kind="paper" id={r.docId} label={`Clear ${r.fileName}`} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {cleared.length ? (
          <details className="group" id="cleared-today">
            <summary className="muted">Cleared today ({cleared.length}): undo a clear</summary>
            <ul className="list">
              {cleared.map((c) => (
                <li className="need-row" key={`${c.kind}-${c.id}`}>
                  <span>{c.kind === "run" ? c.label : words(c.fileName ?? "", c.syllabusId ?? "", c.code ?? "")} <span className="muted">cleared {dateFmt.format(c.at)}</span></span>
                  <ClearButton kind={c.kind} id={c.id} undo label="Undo the clear" />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2 className="subtitle">Recent activity</h2>
        {events.length === 0 ? (
          <Empty title="Nothing yet." />
        ) : (
          <ul className="list">
            {events.map((ev, i) => (
              <li className="list-row" key={i}>
                <span>{activityWords(ev.action)}</span>
                <time className="muted" dateTime={new Date(ev.at).toISOString()}>
                  {dateFmt.format(ev.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
