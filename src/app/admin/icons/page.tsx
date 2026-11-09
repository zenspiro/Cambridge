import { ADMIN_EDIT, ADMIN_VIEW, allowed, requireStaff } from "@/lib/auth/staff";
import type { Metadata } from "next";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { AppIcon } from "@/components/icons/AppIcon";
import { IconPicker } from "@/components/icons/IconPicker";
import { ICON_NAMES, ICON_SLOTS, iconWords, readIcons } from "@/lib/icons";

export const metadata: Metadata = { title: "Icons" };

const MESSAGES = {
  ok_saved: "Icon saved.",
  ok_reset: "Default icon back.",
  bad: "That icon could not be saved. Please try again.",
  busy: "Too many changes this hour. Please wait a little.",
};

/** Settings > Icons (owner, 9 Nov 2026): every place an icon shows, its icon now, Change (the picker) and Default. */
export default async function IconsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requireStaff(ADMIN_VIEW);
  const q = await searchParams;
  const icons = await readIcons((await getEnv()).DB);
  const groups = [...new Set(ICON_SLOTS.map((s) => s.group))];
  return (
    <AdminShell
      readOnly={!allowed(staff, ADMIN_EDIT)}
      current="/admin/icons"
      title="Icons"
      crumbs={[{ label: "Settings" }, { label: "Icons" }]}
      intro={`Which icon shows where: the admin menu and the student and parent pages. Change opens the picker with ${ICON_NAMES.length} icons; Default puts the original back. Changes show at once, in every theme.`}
    >
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      {groups.map((g) => (
        <section className="card stack" key={g} id={`icons-${g.toLowerCase().replace(/\s+/g, "-")}`}>
          <h2 className="subtitle">{g}</h2>
          <table className="table">
            <thead>
              <tr><th scope="col">Place</th><th scope="col">Icon</th><th scope="col">Name</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {ICON_SLOTS.filter((s) => s.group === g).map((s) => {
                const now = icons[s.id] ?? s.default;
                return (
                  <tr key={s.id} data-slot={s.id}>
                    <td>{s.label}</td>
                    <td><AppIcon name={now} className="icon-preview" /></td>
                    <td>{iconWords(now)}{now === s.default ? <span className="muted"> (default)</span> : null}</td>
                    <td>
                      <span className="row-actions">
                        <IconPicker slot={s.id} place={`${g}: ${s.label}`} current={now} />
                        {now !== s.default ? (
                          <ActionForm className="inline-form" action="/admin/icons/save" messages={MESSAGES}>
                            <input type="hidden" name="slot" value={s.id} />
                            <input type="hidden" name="to" value="default" />
                            <button className="btn btn-small" type="submit">Default</button>
                          </ActionForm>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </AdminShell>
  );
}
