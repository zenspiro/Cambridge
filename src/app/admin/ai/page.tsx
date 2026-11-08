import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { AiUsage } from "@/components/AiUsage";
import { BRAIN } from "@/lib/config";
import { aiModels, lastCheck, STATUS_WORDS, type AiCheck, type ClaudeRole, type ModelStatus } from "@/lib/brain/aiSetup";
import { isActive, lastCheckRun } from "@/lib/brain/runs";
import { reasonWords } from "@/lib/brain/labels";
import { dayStart, monthBounds, readCap, readPrices, recentRuns, spendBetween, taskWords, usdWords, workersAiBetween, type RunSpend } from "@/lib/brain/spend";
import { dateFmt } from "@/lib/library/labels";

export const metadata: Metadata = { title: "AI setup" };

const MESSAGES = {
  ok_started: "Started. The check runs on GitHub with your keys and takes a minute or two. The page updates by itself.",
  ok_model: "Saved. The next runs use this model.",
  bad_model: "That model cannot be chosen. Run the check for that AI again and pick from its list.",
  ok_price: "Price saved.",
  bad_price: "Prices are US dollars per million tokens, like 2 or 0.075. Leave both boxes empty to remove a price.",
  ok_cap: "Spending cap saved.",
  bad_cap: "The cap is a dollar amount, like 20. Leave it empty or 0 for no cap.",
  running: "A brain run is already going. Wait for it to finish.",
  busy: "Too many runs this hour. Please wait a little.",
  not_set_up: "Starting runs is not set up yet (GITHUB_TOKEN).",
  github: "GitHub refused to start the run. Check the GITHUB_TOKEN secret.",
};

const pill = (s: ModelStatus) => (s === "ok" ? "pill pill-ok" : s === "untested" ? "pill" : s === "busy" ? "pill pill-gap" : "pill pill-none");

// AI setup (owner, 6 Nov 2026): the two AIs side by side (Claude reads, Gemini checks), each with its own check
// button and a dropdown of the models its key can use; the usage and spend dashboard; the monthly cap; the prices
// the spend is worked out from; and the last Gemini check's full list. Checks and runs happen on GitHub, where the
// keys are.
export default async function AiSetupPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string; month?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const db = env.DB;
  const now = Date.now();
  const month = monthBounds(q.month, now);
  const thisMonth = monthBounds(undefined, now);
  const current = month.key === thisMonth.key;
  const [models, check, run, prices, cap] = await Promise.all([aiModels(db, env), lastCheck(db), lastCheckRun(db), readPrices(db), readCap(db)]);
  const [summary, monthNow, today, runs, workers, syllabi] = await Promise.all([
    spendBetween(db, month.from, month.to, prices),
    current ? null : spendBetween(db, thisMonth.from, thisMonth.to, prices),
    spendBetween(db, dayStart(now), now + 1, prices),
    recentRuns(db, prices),
    workersAiBetween(db, month.from, month.to),
    db.prepare(`SELECT id, code, valid_from_year FROM syllabus`).bind().all<{ id: string; code: string; valid_from_year: number }>(),
  ]);
  const active = isActive(run);
  const bySyllabus = new Map(syllabi.results.map((s) => [s.id, s]));
  const runLink = (r: RunSpend) => {
    if (r.task === "check") return { href: "#in-use", label: taskWords("check").replace(/s$/, "") };
    const y = r.syllabusId ? bySyllabus.get(r.syllabusId) : undefined;
    return y ? { href: `/admin/library/${y.code}/topics/${y.valid_from_year}`, label: `Topic tree, ${y.code} syllabus from ${y.valid_from_year}` } : null;
  };
  // Models in the price table: the two in use, any priced, any used this month.
  const priceModels = [...new Set([models.claude, models.gemini, models.reading, models.drawing, ...Object.keys(prices), ...summary.byModel.map((m) => m.model)])].filter(Boolean);

  return (
    <AdminShell
      current="/admin/ai"
      title="AI setup"
      intro="Which AI models the subject brain uses, checks that each key works, and what the AIs cost this month against your cap."
      actions={<>
        <a className="btn" href="#usage">Usage and spend</a>
        <a className="btn" href="#cap">Monthly cap</a>
      </>}
    >
      {active ? <meta httpEquiv="refresh" content={String(BRAIN.refreshSeconds)} /> : null}
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <section className="card stack" id="in-use">
        <h2 className="subtitle">Models in use</h2>
        {run && active ? <p className="notice" role="status">{run.status === "queued" ? "Waiting for GitHub to start the check" : run.step ?? "Checking"}. This page refreshes every {BRAIN.refreshSeconds} seconds.</p> : null}
        {run && run.status === "failed" ? <p className="alert" role="alert">The last check stopped: {reasonWords(run.errorRef)}</p> : null}
        <div className="ai-pair">
          <AiBox provider="claude" role="Main AI (topic trees; papers too unless the Reading AI is set)" model={models.claude} chosen={models.claudeChosen} check={check} active={active} />
          <AiBox provider="gemini" role="Checking AI (reads them again to compare)" model={models.gemini} chosen={models.geminiChosen} check={check} active={active} />
          <RoleBox role="reading" model={models.reading} chosen={models.readingChosen} check={check} />
          <RoleBox role="drawing" model={models.drawing} chosen={models.drawingChosen} check={check} />
        </div>
        <p className="muted">
          Each check runs on GitHub with your keys and costs a fraction of a cent. Check Claude asks Anthropic which Claude models your key can use and tries the
          one in use. Check Gemini asks Google which Gemini models your key can use and tries the one in use and up to {BRAIN.checkModels} others. A model your
          plan does not include says so.
        </p>
      </section>

      <AiUsage
        month={{ key: month.key, label: month.label, prev: month.prev, next: month.next, current }}
        today={today}
        summary={summary}
        cap={cap}
        spentThisMonth={(monthNow ?? summary).total}
        runs={runs}
        runLink={runLink}
        workers={workers}
      />

      <section className="card stack" id="cap">
        <h2 className="subtitle">Monthly spending cap</h2>
        <p className="muted">
          Before each run starts, its rough cost is worked out. A run that would take this month past the cap does not start. Checks are not stopped (they
          cost almost nothing). Months follow UTC.
        </p>
        <ActionForm className="inline-form" action="/admin/ai/cap" messages={MESSAGES}>
          <label className="field">
            <span className="label-inline">Cap in US dollars a month (empty for no cap)</span>
            <input className="input input-money" name="cap" inputMode="decimal" defaultValue={cap > 0 ? String(cap) : ""} placeholder="No cap" />
          </label>
          <button className="btn btn-primary" type="submit">Save cap</button>
        </ActionForm>
      </section>

      <section className="card stack" id="prices">
        <h2 className="subtitle">Prices</h2>
        <p className="muted">
          US dollars per million tokens, copied from Anthropic&apos;s and Google&apos;s pricing pages. Spend is worked out from these; a model without a price
          shows &quot;price not set&quot;. Claude prices were filled in from Anthropic&apos;s list of October 2026. On Gemini&apos;s free tier, set both to 0.
        </p>
        <table className="info-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Price</th></tr></thead>
          <tbody>
            {priceModels.map((m) => (
              <tr key={m} id={`price-${m}`}>
                <td>{m.startsWith("claude-") ? "Claude" : "Gemini"} <span className="mono muted">{m}</span>{m === models.claude || m === models.gemini || m === models.reading || m === models.drawing ? <span className="muted"> (in use)</span> : null}</td>
                <td>
                  <ActionForm className="price-form" action="/admin/ai/price" messages={MESSAGES}>
                    <input type="hidden" name="model" value={m} />
                    <label className="field">
                      <span className="label-inline">Input</span>
                      <input className="input input-money" name="in" inputMode="decimal" defaultValue={prices[m] ? String(prices[m].in) : ""} />
                    </label>
                    <label className="field">
                      <span className="label-inline">Output</span>
                      <input className="input input-money" name="out" inputMode="decimal" defaultValue={prices[m] ? String(prices[m].out) : ""} />
                    </label>
                    <button className="btn btn-small" type="submit">Save</button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {check && check.models.length ? (
        <section className="card stack" id="check">
          <h2 className="subtitle">Gemini models your key can use ({check.models.length}), {check.models.filter((m) => m.status === "ok").length} working</h2>
          <p className="muted">From the Gemini check of {dateFmt.format(check.geminiAt || check.at)}.</p>
          <table className="info-table">
            <thead><tr><th scope="col">Model</th><th scope="col">Result</th></tr></thead>
            <tbody>
              {check.models.map((m) => (
                <tr key={m.name} id={`model-${m.name}`}>
                  <td>{m.label} <span className="mono muted">{m.name}</span>{m.name === models.gemini ? <span className="muted"> (in use)</span> : null}</td>
                  <td><span className={pill(m.status)}>{STATUS_WORDS[m.status]}</span>{m.detail && m.status !== "ok" ? <details className="model-detail"><summary className="link">Google&apos;s words</summary><span className="muted">{m.detail}</span></details> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </AdminShell>
  );
}

const ROLE_WORDS: Record<ClaudeRole, { title: string; spend: string }> = {
  reading: { title: "Reading AI: reads question papers and mark schemes", spend: "Its spend shows under Reading papers on the dashboard below." },
  drawing: { title: "Drawing AI: redraws the figures (used from paper reading on)", spend: "Its spend shows as its own job (Drawing figures) on the dashboard below." },
};

/**
 * A Claude model of its own for one job: the reading AI (owner, 8 Nov 2026: a cheaper model can read papers while topic
 * trees keep the main AI) and the drawing AI (7 Nov 2026). It picks from the Claude check's list and has no check of
 * its own; until chosen it is the main AI's model.
 */
function RoleBox({ role, model, chosen, check }: { role: ClaudeRole; model: string; chosen: boolean; check: AiCheck | null }) {
  const options = check?.claudeModels ?? [];
  const list = options.some((o) => o.name === model) ? options : model ? [{ name: model, label: model }, ...options] : options;
  return (
    <div className="ai-box stack" id={`ai-${role}`}>
      <h3 className="label-inline">{ROLE_WORDS[role].title}</h3>
      <dl className="facts">
        <dt>Model</dt><dd><span className="mono">{model || "not set"}</span> <span className="muted">{chosen ? "(chosen here)" : "(the same as the main AI)"}</span></dd>
      </dl>
      {options.length ? (
        <ActionForm className="inline-form" action="/admin/ai/model" messages={MESSAGES}>
          <input type="hidden" name="provider" value={role} />
          <label className="field">
            <span className="label-inline">Claude models your key can use</span>
            <select className="input" name="model" defaultValue={model} key={model}>
              {list.map((m) => <option key={m.name} value={m.name}>{m.label === m.name ? m.name : `${m.label} (${m.name})`}</option>)}
            </select>
          </label>
          <button className="btn btn-small" type="submit">Use this model</button>
        </ActionForm>
      ) : <p className="muted">Check Claude to see the models your key can use.</p>}
      <p className="muted">{ROLE_WORDS[role].spend}</p>
    </div>
  );
}

/** One AI: its model, last check result, model dropdown and its own check button. */
function AiBox({ provider, role, model, chosen, check, active }: { provider: "claude" | "gemini"; role: string; model: string; chosen: boolean; check: AiCheck | null; active: boolean }) {
  const name = provider === "claude" ? "Claude" : "Gemini";
  const at = provider === "claude" ? check?.claudeAt : check?.geminiAt;
  const result = at ? (provider === "claude" ? check?.claude : check?.gemini) : null;
  // Claude: Anthropic's list for the key. Gemini: only models the check found working.
  const options = !check ? [] : provider === "claude" ? check.claudeModels : check.models.filter((m) => m.status === "ok");
  const list = options.some((o) => o.name === model) ? options : model ? [{ name: model, label: model }, ...options] : options;
  return (
    <div className="ai-box stack" id={`ai-${provider}`}>
      <h3 className="label-inline">{name}: {role}</h3>
      <dl className="facts">
        <dt>Model</dt><dd><span className="mono">{model || "not set"}</span> <span className="muted">{chosen ? "(chosen here)" : "(the default in wrangler.jsonc)"}</span></dd>
        <dt>Last check</dt>
        <dd>
          {result && at ? (
            <>
              <span className={pill(result.status)}>{STATUS_WORDS[result.status]}</span> <span className="muted">{dateFmt.format(at)}</span>
              {result.detail && result.status !== "ok" ? (
                <details className="model-detail"><summary className="link">{provider === "claude" ? "Anthropic's" : "Google's"} words</summary><span className="muted">{result.detail}</span></details>
              ) : null}
            </>
          ) : <span className="muted">Not checked yet</span>}
        </dd>
      </dl>
      {options.length ? (
        <ActionForm className="inline-form" action="/admin/ai/model" messages={MESSAGES}>
          <input type="hidden" name="provider" value={provider} />
          <label className="field">
            <span className="label-inline">{provider === "claude" ? "Models your key can use" : "Models that worked in the last check"}</span>
            <select className="input" name="model" defaultValue={model} key={model}>
              {list.map((m) => <option key={m.name} value={m.name}>{m.label === m.name ? m.name : `${m.label} (${m.name})`}</option>)}
            </select>
          </label>
          <button className="btn btn-small" type="submit">Use this model</button>
        </ActionForm>
      ) : <p className="muted">Check {name} to see the models your key can use.</p>}
      <ActionForm className="inline-form" action="/admin/ai/check" messages={MESSAGES}>
        <input type="hidden" name="which" value={provider} />
        <button className="btn btn-primary" type="submit" disabled={active}>Check {name}</button>
      </ActionForm>
    </div>
  );
}
