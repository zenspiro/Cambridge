# Admin guide

## Signing in
1. Go to `/admin` on the site. You land on the sign-in page.
2. Type the admin password and press Sign in.
3. You stay signed in for 12 hours, or until you press Sign out.

The password is the `ADMIN_PASS` secret in the Cloudflare dashboard (Worker `cambridge`, Settings, Variables and Secrets). To change it, edit the secret there. It must be at least 12 characters, or sign-in switches off.

## If sign-in is locked
After 5 wrong tries from one network, sign-in pauses for 15 minutes from the first try. Other networks are not affected.

## Recent activity
The admin home lists the latest sign-ins, sign-outs, wrong passwords and lockouts, in Pakistan time.

## Source library
The library holds Cambridge files for Physics 0625, 2022 to 2026. Only admins can see it, and every download is written to the activity log.

- **Library:** files grouped by session (March, June, November, Specimen). Filter by year, session, type or paper. Download saves the PDF to your computer.
- **Gaps:** for each session, how many expected files are stored, with the missing names listed under "missing". Sessions whose papers are not public yet are left out.
- **Upload:** choose up to 20 PDFs (90 MB) at once. Files must keep Cambridge's names, like `0625_s23_qp_42.pdf`. Each file shows Stored or the reason it was skipped (wrong name, not a PDF, outside 2022 to 2026, already stored).

## Approved sources
The websites the download agent may visit. It starts with Cambridge's official site.

- **Add:** a name and a full https address. IP addresses, logins and local addresses are refused.
- **Switch off / on:** the agent skips switched-off sources.
- **Remove:** asks "Remove this source?" first. Choose Yes, remove or Never mind. Files already downloaded from it stay in the library.

Only add a source if you are sure its files may be used (brief section 3).
