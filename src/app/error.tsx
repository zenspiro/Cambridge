"use client";

// Visitors see a reference only (brief 15.2). Next logs the full error on the
// server with the same digest, so the reference can be found in Workers Logs.
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="shell">
      <div className="card">
        <h1 className="title">Something went wrong</h1>
        <p className="lead">Please try again. If it keeps happening, quote this reference.</p>
        {error.digest ? <code className="ref">{error.digest}</code> : null}
      </div>
    </main>
  );
}
