import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { currentBrand } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { BRAND, THEMES } from "@/lib/config";
import { IMAGE_KINDS, brandUrl, footerText } from "@/lib/brand";

export const metadata: Metadata = { title: "Brand" };

const TEXT_MESSAGES = {
  ok_saved: "Saved. Every page uses the new wording now.",
  bad_text: `Check the fields: the name (up to ${BRAND.maxNameLength} characters) and short name (up to ${BRAND.maxShortNameLength}) are needed, on one line each. The email sender must be a plain address like noreply@example.com.`,
  busy: "Too many changes this hour. Please wait a little.",
};

const IMAGE_MESSAGES = {
  ok_image: "Uploaded. It shows everywhere now.",
  ok_removed: "Removed. The platform name shows as text instead.",
  bad_type: "That file is not a PNG, JPG or WebP picture. SVG files are not accepted (they can carry hidden scripts).",
  too_big: `That picture is too big. The limit is ${Math.round(BRAND.maxImageBytes / 1024)} KB.`,
  empty: "Choose a picture first.",
  bad_kind: "That did not work. Please reload the page and try again.",
  busy: "Too many changes this hour. Please wait a little.",
};

export default async function BrandPage() {
  await requireAdmin();
  const brand = await currentBrand();
  return (
    <AdminShell
      current="/admin/brand"
      title="Brand"
      intro="The name, wording and pictures every student, parent and teacher page uses. Changes show at once."
      actions={<Link className="btn" href="/admin/themes">See them in the theme gallery</Link>}
    >

      <ActionForm className="card stack" action="/admin/brand/save" messages={TEXT_MESSAGES}>
        <h2 className="subtitle">Name and wording</h2>
        <div className="form-grid">
          <label className="field">
            <span className="label-inline">Platform name</span>
            <input className="input" name="name" required maxLength={BRAND.maxNameLength} defaultValue={brand.name} />
          </label>
          <label className="field">
            <span className="label-inline">Short name (phone home screens)</span>
            <input className="input" name="shortName" required maxLength={BRAND.maxShortNameLength} defaultValue={brand.shortName} />
          </label>
        </div>
        <label className="field">
          <span className="label-inline">Description (search results and link previews)</span>
          <input className="input" name="description" maxLength={BRAND.maxDescriptionLength} defaultValue={brand.description} />
        </label>
        <label className="field">
          <span className="label-inline">Footer statement</span>
          <textarea className="input brand-footer-input" name="footer" maxLength={BRAND.maxFooterLength} defaultValue={brand.footer} />
          <span className="muted">Write {"{name}"} where the platform name should go. It reads now: {footerText(brand)}</span>
        </label>
        <label className="field">
          <span className="label-inline">Email sender (sign-in codes come from this address)</span>
          <input className="input brand-email-input" name="emailFrom" type="email" maxLength={BRAND.maxEmailLength} defaultValue={brand.emailFrom} placeholder="noreply@example.com" />
          <span className="muted">Its domain must be set up in Resend. Emails show as coming from {brand.name}. Empty: no sign-in codes can be sent.</span>
        </label>
        <label className="field brand-theme-field">
          <span className="label-inline">Theme for new students</span>
          <select className="input" name="defaultTheme" defaultValue={brand.defaultTheme}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">Save</button>
      </ActionForm>

      <section className="card stack">
        <h2 className="subtitle">Pictures</h2>
        <p className="muted">PNG, JPG or WebP, up to {Math.round(BRAND.maxImageBytes / 1024)} KB each. Without a picture, the platform name shows as text.</p>
        <ul className="list">
          {IMAGE_KINDS.map((kind) => {
            const img = brand.images[kind];
            const info = BRAND.imageKinds[kind];
            return (
              <li className="brand-row" key={kind} id={`brand-${kind}`}>
                <div className="brand-preview">
                  {img ? <img className={`brand-img brand-img-${kind}`} src={brandUrl(img)} alt={`${info.label} now`} /> : <span className="muted">Not set</span>}
                </div>
                <div className="doc-main brand-info">
                  <span className="label-inline">{info.label}</span>
                  <span className="muted">{info.hint}</span>
                </div>
                <div className="brand-actions">
                  <ActionForm className="inline-form" action="/admin/brand/image" messages={IMAGE_MESSAGES}>
                    <input type="hidden" name="kind" value={kind} />
                    <input className="input brand-file" type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label={`${info.label} file`} />
                    <button className="btn" type="submit">{img ? "Replace" : "Upload"}</button>
                  </ActionForm>
                  {img ? (
                    <ActionForm className="inline-form" action="/admin/brand/remove" messages={IMAGE_MESSAGES} confirm={`Remove the ${info.label.toLowerCase()}?`}>
                      <input type="hidden" name="kind" value={kind} />
                      <button className="btn btn-danger" type="submit">Remove</button>
                    </ActionForm>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </AdminShell>
  );
}
