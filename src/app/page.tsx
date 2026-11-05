import { appName } from "@/lib/env";

export default async function Home() {
  const name = await appName();
  return (
    <main className="shell">
      <div className="card">
        <h1 className="title">{name}</h1>
        <p className="lead">We are building this. Practice questions, marking and progress tracking are on the way.</p>
        <p className="lead"><a className="link" href="/signin">Sign in</a></p>
      </div>
    </main>
  );
}
