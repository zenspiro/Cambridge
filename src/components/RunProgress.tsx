"use client";
// Live progress of a brain run (owner, 7 Nov 2026: "show real progress per model instead of just refreshing"). Asks
// the server for the run's state every few seconds while it runs and updates in place: one row per step (the PDF,
// Gemini, Claude, a second try, the drawings, the checks, saving) with what it is doing, the model, tokens and time.
// When the run ends it refreshes the page's data once (same scroll, no reload).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Event = { at: number; stage: string; state: "start" | "wait" | "done" | "fail" | "skip"; text: string; model: string; tokens: number };
type BatchPaper = { docId: string; name: string; read: boolean; flags: number; now: boolean };
type State = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; step: string | null; events: Event[]; createdAt: number; finishedAt: number | null; stopped: string | null;
  /** Read all: where the batch is and each paper's state. */
  batch?: { label: string; at: number; of: number; papers: BatchPaper[] } | null;
};

const LABELS: Record<string, string> = {
  pdf: "The PDF", gemini: "Gemini (checking AI)", claude: "Claude (main AI)", retry: "Claude, second try", figures: "Figures (cut from the PDF)", drawing: "Drawing AI", checks: "Checks", save: "Saving",
};
const STATE_WORDS = { start: "Working", wait: "Waiting", done: "Done", fail: "Stopped", skip: "Not needed" } as const;
const n = new Intl.NumberFormat("en-GB");

function since(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function RunProgress({ runId, stages, intervalMs = 3000 }: { runId: string; stages: readonly string[]; intervalMs?: number }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const r = await fetch(`/admin/brain/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json()) as State;
          if (stop) return;
          setState(s);
          setNow(Date.now());
          if (s.status !== "queued" && s.status !== "running") {
            if (!refreshed.current) {
              refreshed.current = true;
              router.refresh();
            }
            return;
          }
        }
      } catch {
        // a missed answer: try again on the next tick
      }
      if (!stop) timer = setTimeout(tick, intervalMs);
    }
    void tick();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [runId, intervalMs, router]);

  if (!state) return <div className="run-progress" role="status"><p className="muted">Checking the run...</p></div>;
  const latest = new Map<string, Event>();
  for (const e of state.events) latest.set(e.stage, e);
  const active = state.status === "queued" || state.status === "running";
  return (
    <div className="run-progress" role="status" aria-live="polite" id="run-progress">
      <p className="run-progress-head">
        <strong>{state.status === "queued" ? "Waiting for GitHub to start the run" : active ? "Running" : state.status === "succeeded" ? "Finished" : "Stopped"}</strong>
        <span className="muted"> {since((state.finishedAt ?? now) - state.createdAt)}</span>
      </p>
      {state.batch ? <BatchHead batch={state.batch} active={active} /> : null}
      <ol className="run-steps">
        {stages.map((stage) => {
          const last = latest.get(stage);
          // A step still "working" when the run has ended finished with it (the run closes on the final save, so
          // the script's last "Saved" note never lands) or stopped with it.
          const e = last && !active && last.state === "start" ? { ...last, state: state.status === "succeeded" ? ("done" as const) : ("fail" as const) } : last;
          const st = e?.state ?? (active ? "wait" : "skip");
          return (
            <li key={stage} className={`run-step run-step-${e ? st : "idle"}`} data-stage={stage}>
              <span className="run-step-dot" aria-hidden="true" />
              <span className="run-step-name">{LABELS[stage] ?? stage}</span>
              <span className="run-step-text">{e ? e.text : active ? "Not started yet" : ""}</span>
              <span className="run-step-meta">
                {e?.model ? <span className="mono">{e.model}</span> : null}
                {e && e.tokens ? <span>{n.format(e.tokens)} tokens</span> : null}
                {e ? <span>{e.state === "start" ? `for ${since(now - e.at)}` : STATE_WORDS[e.state]}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {state.stopped ? <p className="alert" role="alert">{state.stopped}</p> : null}
      {state.batch ? <BatchList papers={state.batch.papers} active={active} /> : null}
    </div>
  );
}

/** Read all: which paper of how many, and a bar of how many are read. */
function BatchHead({ batch, active }: { batch: NonNullable<State["batch"]>; active: boolean }) {
  const read = batch.papers.filter((p) => p.read).length;
  const flagged = batch.papers.filter((p) => p.read && p.flags > 0).length;
  const current = batch.papers.find((p) => p.now);
  return (
    <div className="batch-head">
      <p className="m-0">
        <strong>{active ? `Paper ${batch.at} of ${batch.of}` : `Done: ${read} of ${batch.of} read`}</strong>
        {active && current ? `: ${current.name}` : !active ? `, ${flagged} with flags to review` : ""}
      </p>
      <progress className="batch-bar" max={batch.of} value={read}>{read} of {batch.of}</progress>
    </div>
  );
}

/** Read all: every paper with where it stands; a read paper links to its review screen. */
function BatchList({ papers, active }: { papers: BatchPaper[]; active: boolean }) {
  return (
    <details className="batch-list" open={!active}>
      <summary className="muted">The papers in this run</summary>
      <ol className="read-plan">
        {papers.map((p) => (
          <li key={p.docId} className="batch-paper">
            <span>{p.name}</span>
            <span className={p.read ? (p.flags ? "pill pill-warn" : "pill pill-ok") : p.now && active ? "pill pill-busy" : "pill"}>
              {p.read ? (p.flags ? `${p.flags} flag${p.flags === 1 ? "" : "s"}` : "Ready") : p.now && active ? "Reading now" : active ? "Waiting" : "Not read"}
            </span>
            {/* A plain link: the review screen needs its own page load for its PDF frame. */}
            {p.read ? <a className="link" href={`/admin/library/review/${encodeURIComponent(p.docId)}`}>Review</a> : <span />}
          </li>
        ))}
      </ol>
    </details>
  );
}
