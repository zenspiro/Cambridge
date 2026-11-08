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
import { activeRuns, activityWords, failedRuns, papersToReview } from "@/lib/adminStatus";
import { rowScore } from "@/lib/brain/paperRead";
import { monthBounds, readCap, readPrices, spendBetween, usdWords } from "@/lib/brain/spend";

export const metadata: Metadata = { title: "Admin" };

/**
 * Home (owner, 8 Nov 2026: a functional admin): what needs the admin now, in one place. Runs that stopped, papers
 * with flags to review, the month's AI spend against the cap, then the latest activity in words.
 */
export default async function AdminHome() {
  await requireAdmin();
  const env = await getEnv();
  const db = env.DB;
  const month = monthBounds(undefined);
  const [events, count, running, failed, review, prices, cap] = await Promise.all([
    recentAudit(db, 15),
    db.prepare(COUNT_ALL_DOCUMENTS).first<{ n: number; subjects: number }>(),
    activeRuns(db),
    failedRuns(db),
    papersToReview(db),
    readPrices(db),
    readCap(db),
  ]);
  const spend = await spendBetween(db, month.from, month.to, prices);
  const codes = [...new Set(review.list.map((r) => r.code))];
  const lookups = new Map(await Promise.all(codes.map(async (c) => [c, paperLookup((await loadPapers(db, c)).papers)] as const)));
  const needs = failed.length + review.total;

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
      </div>

      <section className="card stack" id="needs-you">
        <div className="card-head">
          <h2 className="subtitle">Needs you</h2>
          {needs ? <span className="pill pill-warn">{needs} to look at</span> : <span className="pill pill-ok">All clear</span>}
        </div>
        {needs === 0 ? (
          <Empty title="Nothing needs you right now.">No run has stopped in the last 7 days and every paper read is ready.</Empty>
        ) : null}
        {failed.length ? (
          <div className="stack-tight">
            <h3 className="label-inline">Runs that stopped (last 7 days)</h3>
            <ul className="list">
              {failed.map((r) => (
                <li className="need-row" key={r.id}>
                  <span className="need-text">
                    <span><span className="pill pill-bad">Stopped</span> {r.label} <span className="muted">{dateFmt.format(r.at)}</span></span>
                    <span className="hint">{r.why}</span>
                  </span>
                  <a className="btn btn-small" href={r.href}>See why</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {review.list.length ? (
          <div className="stack-tight">
            <h3 className="label-inline">Papers with flags to review{review.total > review.list.length ? ` (the ${review.list.length} with the most of ${review.total})` : ""}</h3>
            <ul className="list">
              {review.list.map((r) => (
                <li className="need-row" key={r.docId}>
                  <span>
                    {describeFile(r.fileName, r.syllabusId, lookups.get(r.code) ?? paperLookup([]))}{" "}
                    <ScoreBadge score={rowScore({ ...r.score, read_at: r.readAt })} />{" "}
                    <span className="muted">{r.open} flag{r.open === 1 ? "" : "s"} open</span>
                  </span>
                  {/* Plain link: the review screen needs its own page load for its PDF frame. */}
                  <a className="btn btn-small" href={`/admin/library/review/${encodeURIComponent(r.docId)}`}>Review</a>
                </li>
              ))}
            </ul>
          </div>
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
