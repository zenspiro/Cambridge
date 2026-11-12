import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { allow, limitKey } from "@/lib/ratelimit";
import { launchAsk } from "@/lib/brain/queue";
import { filterQuery, readFilter } from "@/lib/brain/readAll";
import { getLibrarySettings, libraryYears } from "@/lib/settings";

// Read all (owner, 8 Nov 2026): one brain run reads every stored question paper and mark scheme not read yet, for Core
// or Extended, one month or every month, one year or every year. The list is worked out again (never taken from the
// form), the whole batch's rough cost is checked against the cap first, and the run checks it again before each
// paper. Another run going on (owner, 12 Nov 2026): it waits in the queue and starts on its own.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return staffPost(request, base, ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    const lib = await getLibrarySettings(db);
    const filter = readFilter((k) => (form.get(k) as string | null) ?? null, libraryYears(lib));
    if (!filter || base === "/admin/library") return "bad";
    const back = (e: string) => `${base}?${filterQuery(filter)}&e=${e}#read-all`;
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    return back(await launchAsk(db, env, { kind: "read", code, filter }, actorId));
  });
}
