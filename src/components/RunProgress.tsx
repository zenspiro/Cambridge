"use client";
// Live progress of a brain run (owner, 7 Nov 2026: "show real progress per model instead of just refreshing"). Asks
// the server for the run's state every few seconds while it runs and updates in place: one row per step (the PDF,
// Gemini, Claude, a second try, the drawings, the checks, saving) with what it is doing, the model, tokens and time.
// When the run ends it refreshes the page's data once (same scroll, no reload).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Event = { at: number; stage: string; state: "start" | "wait" | "done" | "fail" | "skip"; text: string; model: string; tokens: number };
type State = { status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; step: string | null; events: Event[]; createdAt: number; finishedAt: number | null; stopped: string | null };

const LABELS: Record<string, string> = {
  pdf: "The PDF", gemini: "Gemini (checking AI)", claude: "Claude (main AI)", retry: "Claude, second try", drawing: "Drawing AI", checks: "Checks", save: "Saving",
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
      <ol className="run-steps">
        {stages.map((stage) => {
          const e = latest.get(stage);
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
    </div>
  );
}
