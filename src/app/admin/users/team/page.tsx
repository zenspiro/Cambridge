import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Empty, Notice } from "@/components/AdminShell";
import { ActionForm } from "@/components/ActionForm";
import { AccessFields } from "@/components/AccessFields";
import { listSubjects } from "@/lib/library/catalog";
import { dateFmt } from "@/lib/library/labels";
import { accessWords, listInvites, listMembers, NO_ACCESS } from "@/lib/auth/team";
import { TEAM } from "@/lib/config";

export const metadata: Metadata = { title: "Team" };

const MESSAGES = {
  ok_invited: "Invite sent.",
  ok_cancelled: "Invite cancelled; its link no longer works.",
  ok_saved: "Access saved. It applies on their next page.",
  ok_paused: "Paused: they cannot open the admin until you resume them.",
  ok_resumed: "Resumed.",
  ok_removed: "Removed from the team. Their sign-in account stays, with no admin access.",
  bad_email: "That email address does not look right.",
  no_name: "Please give their name.",
  no_access: "Give at least one area (View or Edit) and at least one subject.",
  member: "That person is already on the team. Change their access below.",
  busy: "Too many invites today. Please try again tomorrow.",
  mail_no_sender: "The invite is saved, but no email sender is set on the Brand page, so it was not sent. Set it, then press Resend.",
  mail_no_key: "The invite is saved, but the email service key (RESEND) is not set, so it was not sent.",
  mail_failed: "The invite is saved, but the email could not be sent. Press Resend to try again.",
  gone: "That was already done or no longer exists.",
  bad: "That did not work. Please try again.",
};

/**
 * Users > Team (owner only, 9 Nov 2026): invite people and give them access per area (library, source review, AI
 * review: view or edit) and per subject; see and change members; pending invites with Resend and Cancel.
 */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const db = (await getEnv()).DB;
  const [subjects, members, invites] = await Promise.all([listSubjects(db), listMembers(db), listInvites(db)]);
  const now = Date.now();
  return (
    <AdminShell
      current="/admin/users/team"
      title="Team"
      crumbs={[{ label: "Users" }, { label: "Team" }]}
      intro={`People who help you. Each gets View or Edit per area and only the subjects you tick. They sign in with a code sent to their email, for ${TEAM.sessionMs / 3_600_000} hours at a time. Setup, money, users, the agent and paid AI runs stay yours.`}
    >
      <Notice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      <section className="card stack" id="invite">
        <h2 className="subtitle">Invite someone</h2>
        <ActionForm className="stack" action="/admin/users/team/invite" messages={MESSAGES}>
          <div className="access-areas">
            <label className="field"><span className="label-inline">Name</span><input className="input" name="name" required maxLength={80} autoComplete="off" /></label>
            <label className="field"><span className="label-inline">Email</span><input className="input" name="email" type="email" required maxLength={254} autoComplete="off" /></label>
          </div>
          <AccessFields subjects={subjects} value={{ ...NO_ACCESS, sourceReview: "view" }} idPrefix="invite" />
          <div className="form-actions"><button className="btn btn-primary" type="submit">Send invite</button></div>
        </ActionForm>
      </section>

      <section className="card stack" id="members">
        <h2 className="subtitle">Members ({members.length})</h2>
        {members.length ? (
          <ul className="list">
            {members.map((m) => (
              <li className="member-row" key={m.userId} data-member={m.email}>
                <div className="member-head">
                  <span><strong>{m.name}</strong> <span className="muted">{m.email}</span> {m.status === "paused" ? <span className="pill pill-warn">Paused</span> : <span className="pill pill-ok">Active</span>}</span>
                  <span className="row-actions">
                    <ActionForm className="inline-form" action="/admin/users/team/member" messages={MESSAGES}>
                      <input type="hidden" name="user" value={m.userId} />
                      <input type="hidden" name="op" value={m.status === "paused" ? "resume" : "pause"} />
                      <button className="btn btn-small" type="submit">{m.status === "paused" ? "Resume" : "Pause"}</button>
                    </ActionForm>
                    <ActionForm className="inline-form" action="/admin/users/team/member" messages={MESSAGES} confirm={`Remove ${m.name} from the team? Their sign-in account stays, with no admin access.`} yes="Yes, remove">
                      <input type="hidden" name="user" value={m.userId} />
                      <input type="hidden" name="op" value="remove" />
                      <button className="btn btn-small btn-danger" type="submit">Remove</button>
                    </ActionForm>
                  </span>
                </div>
                <p className="hint m-0">{accessWords(m.access)}. Joined {dateFmt.format(m.createdAt)}.</p>
                <details className="member-edit">
                  <summary className="link">Change access</summary>
                  <ActionForm className="stack" action="/admin/users/team/member" messages={MESSAGES}>
                    <input type="hidden" name="user" value={m.userId} />
                    <input type="hidden" name="op" value="access" />
                    <AccessFields subjects={subjects} value={m.access} idPrefix={`m-${m.userId}`} />
                    <div className="form-actions"><button className="btn btn-primary" type="submit">Save access</button></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        ) : <Empty title="No team members yet.">Invite someone above. They appear here once they accept.</Empty>}
      </section>

      <section className="card stack" id="invites">
        <h2 className="subtitle">Invites waiting ({invites.length})</h2>
        {invites.length ? (
          <table className="table">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Access</th><th scope="col">Link works until</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} data-invite={i.email}>
                  <td>{i.name}</td>
                  <td>{i.email}</td>
                  <td>{accessWords(i.access)}</td>
                  <td>{i.expiresAt < now ? <span className="pill pill-warn">Ran out</span> : dateFmt.format(i.expiresAt)}</td>
                  <td>
                    <span className="row-actions">
                      <ActionForm className="inline-form" action="/admin/users/team/invite/resend" messages={MESSAGES}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="btn btn-small" type="submit">Resend</button>
                      </ActionForm>
                      <ActionForm className="inline-form" action="/admin/users/team/invite/cancel" messages={MESSAGES} confirm="Cancel this invite? Its link stops working.">
                        <input type="hidden" name="id" value={i.id} />
                        <button className="btn btn-small" type="submit">Cancel</button>
                      </ActionForm>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No invites waiting." />}
      </section>
    </AdminShell>
  );
}
