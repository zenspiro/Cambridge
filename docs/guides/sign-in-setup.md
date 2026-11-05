# Student and parent sign-in: setup

Everything here is set by the owner in Cloudflare or Google. Secret values are never written in code or chat.

## Secrets on the `cambridge` Worker
Workers & Pages > cambridge > Settings > Variables and Secrets. Each must be type **Secret**.
- `BETTER_AUTH_SECRET`: any random text of 32 or more characters. Without it, the sign-in page says sign-in is not open yet. Changing it signs everyone out.
- `RESEND`: the Resend API key used to send sign-in codes.
- `OAUTH_CLIENT_ID` and `OAUTH_CLIENT_SECRET`: Google sign-in. Without both, the Google button is hidden and email codes still work.

## Email sender
Admin > Brand > "Email sender": a plain address on a domain set up in Resend (for now noreply@clovedesk.com). Emails show as coming from the platform name. Empty: no codes can be sent.

## Google sign-in
In Google Cloud Console > APIs & Services > Credentials > the OAuth client (type "Web application"):
- **Authorised JavaScript origins:** `https://cambridge.zenspiroapps.workers.dev`
- **Authorised redirect URIs:** `https://cambridge.zenspiroapps.workers.dev/api/auth/callback/google`
- The consent screen (OAuth consent screen / Branding) shows the app name and support email to people signing in. While it is in "Testing", only listed test users can sign in; publish it for everyone.
When the app moves to its own domain, add the new origin and redirect URI the same way.
