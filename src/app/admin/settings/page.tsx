import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { CONSENT, SESSION_LABELS } from "@/lib/config";
import { getConsentSettings } from "@/lib/account/profile";
import { countryName, countryOptions } from "@/lib/countries";
import { ActionForm } from "@/components/ActionForm";
import { getLibrarySettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

const MESSAGES = {
  ok_saved: "Settings saved.",
  bad: "Check the years (From not after To, at most 15 years apart, latest public session inside them) and tick at least one essential variant per session.",
  busy: "Too many changes this hour. Please wait a little.",
};

const CONSENT_MESSAGES = {
  ok_consent: "Saved. It applies to every student from now on.",
  bad_age: `Pick a country and an age from ${CONSENT.minAge} to ${CONSENT.maxAge}.`,
  busy: "Too many changes this hour. Please wait a little.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  const consent = await getConsentSettings(env.DB);
  const overrides = Object.entries(consent.byCountry).sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])));
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
        <h2 className="subtitle">Default essential variants</h2>
        <p className="muted">
          Used for any syllabus that has no setting of its own (each subject page has its own, under &quot;Essential
          variants&quot;). Pakistan sits variant 2. Cambridge&apos;s public site carries variant 1.
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

      <section className="card stack" id="consent">
        <h2 className="subtitle">Parent approval</h2>
        <p className="muted">
          Students under this age need a parent or guardian to approve their account (owner decision: under 18). Only the
          birth year is known, so a student who could still be under it is asked.
        </p>
        <ActionForm className="inline-form" action="/admin/settings/consent" messages={CONSENT_MESSAGES}>
          <label className="field">
            <span className="label-inline">Approval needed under age</span>
            <input className="input consent-age" name="defaultAge" type="number" min={CONSENT.minAge} max={CONSENT.maxAge} required defaultValue={consent.defaultAge} />
          </label>
          <button className="btn" type="submit">Save</button>
        </ActionForm>
        <h3 className="label-inline">Countries with a different age</h3>
        {overrides.length ? (
          <ul className="list">
            {overrides.map(([c, age]) => (
              <li className="list-row" key={c}>
                <span>{countryName(c)}: under {age}</span>
                <ActionForm action="/admin/settings/consent/remove" messages={CONSENT_MESSAGES}>
                  <input type="hidden" name="country" value={c} />
                  <button className="btn btn-small" type="submit">Use the default</button>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None: every country uses the age above.</p>
        )}
        <ActionForm className="inline-form" action="/admin/settings/consent/country" messages={CONSENT_MESSAGES}>
          <label className="field">
            <span className="label-inline">Country</span>
            <select className="input" name="country" required defaultValue="">
              <option value="" disabled>Choose a country</option>
              {countryOptions().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label-inline">Under age</span>
            <input className="input consent-age" name="age" type="number" min={CONSENT.minAge} max={CONSENT.maxAge} required />
          </label>
          <button className="btn" type="submit">Add</button>
        </ActionForm>
      </section>
    </AdminShell>
  );
}
