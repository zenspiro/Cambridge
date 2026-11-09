import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { findSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin sign in" };

// Fixed messages by code: nothing from the address bar is ever shown as text.
const MESSAGES: Record<string, string> = {
  bad: "That password is not right.",
  locked: "Too many tries. Please wait 15 minutes and try again.",
  unavailable: "Sign-in is not available right now.",
  expired: "Please sign in again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const env = await getEnv();
  const token = (await cookies()).get(AUTH.cookieName)?.value;
  if (await findSession(env.DB, token)) redirect("/admin");

  const { e } = await searchParams;
  const message = e && Object.hasOwn(MESSAGES, e) ? MESSAGES[e] : null;
  return (
    <main className="shell shell-narrow">
      <form className="card" method="post" action="/admin/session">
        <h1 className="title">Admin sign in</h1>
        {message ? (
          <p className="alert" role="alert">
            {message}
          </p>
        ) : null}
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={AUTH.maxPasswordLength}
          autoFocus
        />
        <button className="btn btn-primary btn-block" type="submit">
          Sign in
        </button>
      </form>
      {/* Team members sign in with their email code (owner, 9 Nov 2026); the password is the owner's. */}
      <p className="muted" id="team-signin">Team member? <a className="link" href="/signin?next=/admin">Sign in with your email</a></p>
    </main>
  );
}
