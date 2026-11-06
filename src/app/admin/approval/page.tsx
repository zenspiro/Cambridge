import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { CONSENT } from "@/lib/config";
import { getConsentSettings } from "@/lib/account/profile";
import { countryName, countryOptions } from "@/lib/countries";

export const metadata: Metadata = { title: "Parent approval" };

const CONSENT_MESSAGES = {
  ok_consent: "Saved. It applies to every student from now on.",
  bad_age: `Pick a country and an age from ${CONSENT.minAge} to ${CONSENT.maxAge}.`,
  busy: "Too many changes this hour. Please wait a little.",
};

// Parent approval ages (owner, 6 Nov 2026: its own page under "Students and parents"). The routes stay under
// /admin/settings/consent and come back here.
export default async function ApprovalPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const consent = await getConsentSettings(env.DB);
  const overrides = Object.entries(consent.byCountry).sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])));
  return (
    <AdminShell current="/admin/approval" title="Parent approval">
      <Notice code={q.e} messages={CONSENT_MESSAGES} errorRef={q.ref} />
      <section className="card stack" id="consent">
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
