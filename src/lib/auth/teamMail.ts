// Sends a team invite email (owner, 9 Nov 2026), the same way as the other account emails (Resend, or the local test
// mailbox on localhost). The link carries the token; nothing else does.
import { currentBrand, type AppEnv } from "@/lib/env";
import { isLocalHost, originOf } from "@/lib/account/server";
import { sendEmail, teamInviteEmail, type SendResult } from "@/lib/account/email";
import { TEAM } from "@/lib/config";
import { accessWords, type Access } from "./team.ts";

export async function sendInvite(request: Request, env: AppEnv, to: string, name: string, access: Access, token: string): Promise<SendResult> {
  const origin = originOf(request.headers);
  const brand = await currentBrand();
  const msg = teamInviteEmail(brand.name, to, name, accessWords(access), `${origin}/team/join/${token}`, TEAM.inviteDays);
  return sendEmail(msg, { platform: brand.name, from: brand.emailFrom, apiKey: env.RESEND, local: env.EMAIL_TRANSPORT === "local" && isLocalHost(origin), bucket: env.FILES });
}
