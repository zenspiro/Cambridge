import { getAuth, googleReady } from "@/lib/account/server";
import { withCookies } from "@/lib/account/http";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

const GOOGLE = "https://accounts.google.com/";

/** "Continue with Google": a plain form POST, answered with a redirect to Google (and Better Auth's state cookie). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const auth = await getAuth(request.headers);
  if (!auth || !(await googleReady())) return redirectTo(request, "/signin?e=google_off");
  try {
    const r = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: "/account/after", newUserCallbackURL: "/account/after", errorCallbackURL: "/signin?e=google" },
      headers: request.headers,
      returnHeaders: true,
    });
    const url = (r.response as { url?: string }).url ?? "";
    // The only place we redirect off our site: Google's own sign-in page, from the address Better Auth built.
    if (!url.startsWith(GOOGLE)) return redirectTo(request, "/signin?e=google");
    const h = withCookies(r.headers, new Headers({ Location: url, "Cache-Control": "no-store" }));
    return new Response(null, { status: 303, headers: h });
  } catch (err) {
    reportError("account.google", err);
    return redirectTo(request, "/signin?e=google");
  }
}
