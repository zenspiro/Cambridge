// Sign-in code emails (Phase 1 step 2). Sent through Resend with the sender address and platform name from the
// Brand page. Locally (EMAIL_TRANSPORT=local on a localhost request) they go to the test mailbox in the FILES
// bucket instead, so tests never send real email. No Next imports (unit tested).
import type { Bucket } from "../db.ts";
import { sha256Hex } from "../auth/crypto.ts";
import { ACCOUNT } from "../config.ts";

export type Email = { to: string; subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The words of a sign-in code email. The code is never logged. */
export function codeEmail(platform: string, to: string, code: string): Email {
  const text = [
    `Your ${platform} sign-in code is ${code}.`,
    "",
    `It works for ${ACCOUNT.codeMinutes} minutes. Type it on the sign-in page.`,
    "If you did not ask for this code, you can ignore this email. Nobody can sign in without it.",
  ].join("\n");
  const html = `<p>Your ${esc(platform)} sign-in code is</p><p><strong>${esc(code)}</strong></p><p>It works for ${ACCOUNT.codeMinutes} minutes. Type it on the sign-in page.</p><p>If you did not ask for this code, you can ignore this email. Nobody can sign in without it.</p>`;
  return { to, subject: `${code} is your ${platform} sign-in code`, text, html };
}

/** Where a test mailbox message is kept: one file per address, the newest wins. */
export const testMailKey = async (to: string) => `dev-mail/${await sha256Hex(to.toLowerCase())}.json`;

export type SendResult = "sent" | "no_sender" | "no_key" | "failed";

/** Sends one email. `local` is true only when EMAIL_TRANSPORT=local and the request came to localhost. */
export async function sendEmail(
  msg: Email,
  o: { platform: string; from: string; apiKey: string | undefined; local: boolean; bucket: Bucket; fetcher?: typeof fetch },
): Promise<SendResult> {
  if (o.local) {
    await o.bucket.put(await testMailKey(msg.to), new TextEncoder().encode(JSON.stringify(msg)), { httpMetadata: { contentType: "application/json" } });
    return "sent";
  }
  if (!o.from) return "no_sender";
  if (!o.apiKey) return "no_key";
  const res = await (o.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${o.platform.replace(/[<>"]/g, "")} <${o.from}>`, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  return res.ok ? "sent" : "failed";
}

/** The parent approval email: who asked, the one-tap link, how long it works. */
export function consentEmail(platform: string, to: string, child: string, link: string, days: number): Email {
  const text = [
    `${child} wants to use ${platform}, a study app for Cambridge exams, and gave your email as their parent or guardian.`,
    "",
    `Please approve or decline here: ${link}`,
    "",
    `The link works for ${days} days. If you decline, their account and everything in it is deleted.`,
    "If you do not know who this is, you can ignore this email.",
  ].join("\n");
  const html = `<p>${esc(child)} wants to use ${esc(platform)}, a study app for Cambridge exams, and gave your email as their parent or guardian.</p><p><a href="${esc(link)}">Approve or decline</a></p><p>The link works for ${days} days. If you decline, their account and everything in it is deleted.</p><p>If you do not know who this is, you can ignore this email.</p>`;
  return { to, subject: `Please approve ${child}'s ${platform} account`, text, html };
}

/** A team invite (owner, 9 Nov 2026): who invites, what access, the one-time link, how long it works. */
export function teamInviteEmail(platform: string, to: string, name: string, access: string, link: string, days: number): Email {
  const text = [
    `Hello ${name},`,
    "",
    `You are invited to help with ${platform}'s admin. Your access: ${access}.`,
    "",
    `Accept here: ${link}`,
    "",
    `You sign in with a code sent to this email address; there is no password. The link works for ${days} days and only once.`,
    "If you did not expect this, you can ignore this email.",
  ].join("\n");
  const html = `<p>Hello ${esc(name)},</p><p>You are invited to help with ${esc(platform)}'s admin. Your access: ${esc(access)}.</p><p><a href="${esc(link)}">Accept the invite</a></p><p>You sign in with a code sent to this email address; there is no password. The link works for ${days} days and only once.</p><p>If you did not expect this, you can ignore this email.</p>`;
  return { to, subject: `You are invited to the ${platform} team`, text, html };
}
