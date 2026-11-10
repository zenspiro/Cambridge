import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/staff";
import { hasSubject } from "@/lib/auth/team";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { DocumentsTable } from "@/components/DocumentsTable";
import { listParam, loadDocRows, readDocFilter } from "@/lib/library/documents";

export const metadata: Metadata = { title: "Documents" };

// Every subject's documents in one table (owner, 10 Nov 2026), with a Subject filter. A team member sees only their
// subjects.
export default async function AllDocuments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff({ area: "library", level: "view" });
  const sp = await searchParams;
  const env = await getEnv();
  const all = await loadDocRows(env.DB, null);
  const rows = staff.owner ? all : all.filter((r) => hasSubject(staff.access, r.code));
  const filter = readDocFilter((k) => listParam(sp[k]));
  return (
    <AdminShell
      current="/admin/library/documents"
      title="Documents"
      intro="Every file stored in the library, with how well the AI read it and whether a person has reviewed it. Filter any column; click a heading to sort."
      crumbs={[{ label: "Library", href: "/admin/library" }, { label: "Documents" }]}
    >
      <DocumentsTable rows={rows} filter={filter} base="/admin/library/documents" showSubject />
    </AdminShell>
  );
}
