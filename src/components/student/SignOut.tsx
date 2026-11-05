/** The sign-out button for the top bar of student and parent pages (a plain form POST). */
export function SignOut() {
  return (
    <form method="post" action="/account/signout">
      <button className="s-btn s-btn-small" type="submit">Sign out</button>
    </form>
  );
}
