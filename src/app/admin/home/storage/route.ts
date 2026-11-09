import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { storageStat } from "@/lib/storage";

// Storage on Home: count again now instead of waiting for the hourly count.
export async function POST(request: Request) {
  return staffPost(request, "/admin", ADMIN_EDIT, async ({ db, env }) => {
    await storageStat(db, env.FILES, Date.now(), true);
    return "ok_counted";
  });
}
