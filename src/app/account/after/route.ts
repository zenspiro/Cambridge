import { accountSession } from "@/lib/account/server";
import { homeFor } from "@/lib/account/roles";
import { redirectTo } from "@/lib/http";

/** Where Google sends people back to: their home, the welcome step, or the sign-in page. */
export async function GET(request: Request) {
  const s = await accountSession();
  return redirectTo(request, s ? homeFor(s.roles) : "/signin");
}
