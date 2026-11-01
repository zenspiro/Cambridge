import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="card">
        <h1 className="title">Page not found</h1>
        <p className="lead">
          <Link className="link" href="/">Go to the home page</Link>
        </p>
      </div>
    </main>
  );
}
