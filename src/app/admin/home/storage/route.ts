import { adminPost } from "@/lib/adminPost";
import { storageStat } from "@/lib/storage";

// Storage on Home: count again now instead of waiting for the hourly count.
export async function POST(request: Request) {
  return adminPost(request, "/admin", async ({ db, env }) => {
    await storageStat(db, env.FILES, Date.now(), true);
    return "ok_counted";
  });
}
