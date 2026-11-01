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
