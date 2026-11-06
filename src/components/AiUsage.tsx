// The AI usage dashboard on the AI setup page (owner request 6 Nov 2026): spend today and this month against the
// cap, usage and spend per model and per job, the latest runs, and the agent's Workers AI. Server component, no
// state. Figures are estimates from the tokens each service reported and the prices typed on the page.
import { taskWords, usdWords, type RunSpend, type Summary } from "@/lib/brain/spend";
import { dateFmt } from "@/lib/library/labels";

const n = new Intl.NumberFormat("en-GB");
const tokens = (t: number) => (t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 10_000 ? `${Math.round(t / 1000)}k` : n.format(t));

export type UsageProps = {
  month: { key: string; label: string; prev: string; next: string | null; current: boolean };
  today: Summary;
  summary: Summary;
  cap: number;
  spentThisMonth: number;
  runs: RunSpend[];
  runLink: (r: RunSpend) => { href: string; label: string } | null;
  workers: { calls: number; tokensIn: number; tokensOut: number };
};

export function AiUsage({ month, today, summary, cap, spentThisMonth, runs, runLink, workers }: UsageProps) {
  const calls = summary.byModel.reduce((a, m) => a + m.calls, 0);
  const capShare = cap > 0 ? Math.min(100, Math.round((spentThisMonth / cap) * 100)) : 0;
  return (
    <section className="card stack" id="usage">
      <div className="usage-head">
        <h2 className="subtitle">AI usage and spend, {month.label}</h2>
        <nav className="row-actions" aria-label="Month">
          <a className="link" href={`/admin/ai?month=${month.prev}#usage`}>Earlier month</a>
          {month.next ? <a className="link" href={month.current ? "/admin/ai#usage" : `/admin/ai?month=${month.next}#usage`}>Later month</a> : null}
        </nav>
      </div>
      <div className="usage-tiles">
        {month.current ? (
          <div className="usage-tile">
            <span className="usage-label">Spent today</span>
            <span className="usage-num">{usdWords(today.total)}</span>
          </div>
        ) : null}
        <div className="usage-tile">
          <span className="usage-label">Spent {month.current ? "this month" : `in ${month.label}`}</span>
          <span className="usage-num">{usdWords(summary.total)}</span>
        </div>
        <div className="usage-tile">
          <span className="usage-label">Questions to Claude and Gemini</span>
          <span className="usage-num">{n.format(calls)}</span>
        </div>
        {month.current ? (
          <div className="usage-tile">
            <span className="usage-label">Monthly cap</span>
            {cap > 0 ? (
              <>
                <span className="usage-num">{usdWords(spentThisMonth)} of {usdWords(cap)}</span>
                <progress className={capShare >= 90 ? "bar bar-none" : capShare >= 70 ? "bar bar-part" : "bar"} max={100} value={capShare}>{capShare}%</progress>
              </>
            ) : <span className="usage-num">No cap</span>}
          </div>
        ) : null}
      </div>
      {summary.unpriced.length ? (
        <p className="alert" role="status">No price set for {summary.unpriced.join(", ")}, so its spend is left out of the totals. Add it under Prices below.</p>
      ) : null}

      <h3 className="label-inline">By model</h3>
      {summary.byModel.length ? (
        <table className="info-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Questions</th><th scope="col">Pages read</th><th scope="col">Tokens in</th><th scope="col">Tokens out</th><th scope="col">Spend</th></tr></thead>
          <tbody>
            {summary.byModel.map((m) => (
              <tr key={m.model}>
                <td>{m.provider === "claude" ? "Claude" : "Gemini"} <span className="mono muted">{m.model}</span></td>
                <td>{n.format(m.calls)}</td>
                <td>{n.format(m.pages)}</td>
                <td>{tokens(m.tokensIn)}</td>
                <td>{tokens(m.tokensOut)}</td>
                <td>{usdWords(m.usd)}</td>
              </tr>
            ))}
            <tr>
              <td>Workers AI <span className="muted">(the agent&apos;s helper, Cloudflare)</span></td>
              <td>{n.format(workers.calls)}</td>
              <td>0</td>
              <td>{tokens(workers.tokensIn)}</td>
              <td>{tokens(workers.tokensOut)}</td>
              <td>Free allowance</td>
            </tr>
          </tbody>
        </table>
      ) : <p className="muted">Claude and Gemini were not used {month.current ? "this month yet" : `in ${month.label}`}. Workers AI: {n.format(workers.calls)} questions (free allowance).</p>}

      {summary.byTask.length ? (
        <>
          <h3 className="label-inline">By job</h3>
          <table className="info-table">
            <thead><tr><th scope="col">Job</th><th scope="col">Questions</th><th scope="col">Pages read</th><th scope="col">Tokens</th><th scope="col">Spend</th></tr></thead>
            <tbody>
              {summary.byTask.map((t) => (
                <tr key={t.task}>
                  <td>{taskWords(t.task)}</td>
                  <td>{n.format(t.calls)}</td>
                  <td>{n.format(t.pages)}</td>
                  <td>{tokens(t.tokensIn + t.tokensOut)}</td>
                  <td>{usdWords(t.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {runs.length ? (
        <>
          <h3 className="label-inline">Latest runs</h3>
          <table className="info-table">
            <thead><tr><th scope="col">When</th><th scope="col">Job</th><th scope="col">Models</th><th scope="col">Tokens</th><th scope="col">Spend</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const link = runLink(r);
                return (
                  <tr key={r.jobId}>
                    <td>{dateFmt.format(r.at)}</td>
                    <td>{link ? <a className="link" href={link.href}>{link.label}</a> : taskWords(r.task)}{r.status === "failed" ? <span className="muted"> (stopped)</span> : null}</td>
                    <td><span className="mono muted">{r.models.join(", ")}</span></td>
                    <td>{tokens(r.tokens)}</td>
                    <td>{usdWords(r.usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <p className="muted">
        These are estimates from the tokens each service reported and the prices below. Your real bill is on the Anthropic Console (Plans &amp; Billing)
        and in Google AI Studio. Gemini on the free tier costs nothing: set its prices to 0.
      </p>
    </section>
  );
}
