import { decideConsent, TOKEN_RE } from "@/lib/account/profile";
import { getEnv } from "@/lib/env";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { reportError } from "@/lib/errors";

/** The parent's answer (a button on the link's page, never the link itself, so mail scanners cannot answer). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return redirectTo(request, "/consent/done?r=unknown");
  try {
    const answer = (await request.formData()).get("answer");
    if (answer !== "approved" && answer !== "declined") return redirectTo(request, `/consent/${token}`);
    const r = await decideConsent((await getEnv()).DB, token, answer);
    return redirectTo(request, `/consent/done?r=${r.ok ? answer : r.reason}`);
  } catch (err) {
    return redirectTo(request, `/consent/${token}?ref=${reportError("consent.answer", err)}`);
  }
}
