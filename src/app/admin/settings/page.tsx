import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { SESSION_LABELS } from "@/lib/config";
import { getLibrarySettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

const MESSAGES = {
  ok_saved: "Settings saved.",
  bad: "Check the years (From not after To, at most 15 years apart, latest public session inside them) and tick at least one essential variant per session.",
  busy: "Too many changes this hour. Please wait a little.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  return (
    <AdminShell current="/admin/settings" title="Settings">
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <form className="card stack" method="post" action="/admin/settings/save">
        <h2 className="subtitle">Library years</h2>
        <p className="muted">
          Which years the library holds, and the latest exam session whose papers are public. When a new session goes
          public: move the latest session forward here, then run the agent for just that session.
        </p>
        <div className="form-grid">
          <label className="field">
            <span className="label-inline">From year</span>
            <input className="input" name="fromYear" type="number" min={2000} max={2100} required defaultValue={lib.fromYear} />
          </label>
          <label className="field">
            <span className="label-inline">To year</span>
            <input className="input" name="toYear" type="number" min={2000} max={2100} required defaultValue={lib.toYear} />
          </label>
          <label className="field">
            <span className="label-inline">Latest public session</span>
            <select className="input" name="lastSession" defaultValue={lib.lastSession.session}>
              {(["m", "s", "w"] as const).map((s) => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label-inline">of year</span>
            <input className="input" name="lastYear" type="number" min={2000} max={2100} required defaultValue={lib.lastSession.year} />
          </label>
        </div>
        <h2 className="subtitle">Essential variants</h2>
        <p className="muted">
          Which variants of each paper must be in the library for a session to count as complete. The others still show as
          extras you can add. Cambridge&apos;s public site has variant 1 (March: variant 2).
        </p>
        {(["m", "s", "w"] as const).map((s) => (
          <fieldset className="fieldset" key={s}>
            <legend className="label-inline">{SESSION_LABELS[s]}</legend>
            <div className="checks">
              {[1, 2, 3].map((v) => (
                <label className="check" key={v}>
                  <input type="checkbox" name={`ev_${s}`} value={v} defaultChecked={lib.essentialVariants[s].includes(v)} /> Variant {v}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <button className="btn btn-primary btn-block" type="submit">Save settings</button>
      </form>
    </AdminShell>
  );
}
