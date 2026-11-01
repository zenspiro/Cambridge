import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { getLibrarySettings } from "@/lib/settings";
import { STORED_NAMES, SYLLABI_BY_CODE } from "@/lib/library/queries";
import { gapReport, parseRules } from "@/lib/library/expected";
import { sessionLabel } from "@/lib/library/labels";

export const metadata: Metadata = { title: "Gap report" };

export default async function GapsPage() {
  await requireAdmin();
  const env = await getEnv();
  const lib = await getLibrarySettings(env.DB);
  const [syl, names] = await Promise.all([
    env.DB.prepare(SYLLABI_BY_CODE).bind("0625").all<{ valid_from_year: number; valid_to_year: number; expected: string }>(),
    env.DB.prepare(STORED_NAMES).bind("0625").all<{ file_name: string }>(),
  ]);
  const have = new Set(names.results.map((r) => r.file_name));
  const cells = gapReport(
    "0625",
    (y) => {
      const s = syl.results.find((r) => r.valid_from_year <= y && r.valid_to_year >= y);
      return s ? parseRules(s.expected) : null;
    },
    have,
    { fromYear: lib.fromYear, toYear: lib.toYear, last: lib.lastSession },
  );
  const expected = cells.reduce((a, c) => a + c.expected, 0);
  const got = cells.reduce((a, c) => a + c.have, 0);

  return (
    <AdminShell current="/admin/library/gaps" title="Gap report">
      <p className="muted">
        Physics 0625: {got} of {expected} expected files stored. Question papers, mark schemes and confidential
        instructions per paper and variant, plus the examiner report and grade thresholds per session.
      </p>
      {cells.map((c) => (
        <section className="card stack" key={`${c.year}${c.session}`}>
          <div className="row-between">
            <h2 className="subtitle">{sessionLabel(c.session, c.year)}</h2>
            <span className={c.missing.length === 0 ? "pill pill-ok" : "pill pill-gap"}>
              {c.have} of {c.expected}
            </span>
          </div>
          {c.missing.length > 0 ? (
            <details>
              <summary className="link">{c.missing.length} missing</summary>
              <ul className="chips">
                {c.missing.map((m) => <li className="chip mono" key={m}>{m}</li>)}
              </ul>
            </details>
          ) : (
            <p className="muted">Complete.</p>
          )}
        </section>
      ))}
    </AdminShell>
  );
}
