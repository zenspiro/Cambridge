import { ADMIN_EDIT, ADMIN_VIEW, allowed, requireStaff } from "@/lib/auth/staff";
import type { Metadata } from "next";
import { getEnv } from "@/lib/env";
import { AdminShell, Empty } from "@/components/AdminShell";
import { listAccounts } from "@/lib/account/list";
import { countryName } from "@/lib/countries";
import { dateFmt } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Students and parents" };

const ROLE_WORDS: Record<string, string> = { student: "Student", parent: "Parent", teacher: "Teacher" };

/** Users > Students and parents (owner only, 9 Nov 2026): every sign-in account, searchable, read-only for now. */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const staff = await requireStaff(ADMIN_VIEW);
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const role = sp.role === "student" || sp.role === "parent" || sp.role === "team" ? sp.role : null;
  const { rows, total } = await listAccounts((await getEnv()).DB, { q, role });
  return (
    <AdminShell
      readOnly={!allowed(staff, ADMIN_EDIT)}
      current="/admin/users/accounts"
      title="Students and parents"
      crumbs={[{ label: "Users" }, { label: "Students and parents" }]}
      intro="Every account that signed in: who they are, their role, country, parent approval and family. Read-only for now; more tools come with the student pages."
    >
      <form className="card filters filters-compact" method="get" role="search">
        <label className="field field-search">
          <span className="sr-only">Search by name or email</span>
          <input className="input" name="q" type="search" maxLength={100} defaultValue={q} placeholder="Search by name or email" />
        </label>
        <label className="field">
          <span className="label-inline">Role</span>
          <select className="input" name="role" defaultValue={role ?? ""}>
            <option value="">Everyone</option>
            <option value="student">Students</option>
            <option value="parent">Parents</option>
            <option value="team">Team members</option>
          </select>
        </label>
        <button className="btn" type="submit">Show</button>
      </form>
      <section className="card stack" id="accounts">
        <h2 className="subtitle">{total} account{total === 1 ? "" : "s"}{rows.length < total ? ` (the newest ${rows.length})` : ""}</h2>
        {rows.length ? (
          <table className="table">
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Country</th><th scope="col">Born</th><th scope="col">Approval</th><th scope="col">Family</th><th scope="col">Joined</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{[...r.roles.map((x) => ROLE_WORDS[x] ?? x), ...(r.team ? ["Team"] : [])].join(", ") || <span className="muted">Not chosen yet</span>}</td>
                  <td>{r.country ? countryName(r.country) : ""}</td>
                  <td>{r.birthYear ?? ""}</td>
                  <td>{r.roles.includes("student") ? (r.approved ? <span className="pill pill-ok">Approved</span> : <span className="pill">Not needed or waiting</span>) : ""}</td>
                  <td>{r.family ? `Parent: ${r.family}` : r.children ? `${r.children} child${r.children === 1 ? "" : "ren"}` : ""}</td>
                  <td>{dateFmt.format(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title={q || role ? "No account matches." : "No accounts yet."} />}
      </section>
    </AdminShell>
  );
}
