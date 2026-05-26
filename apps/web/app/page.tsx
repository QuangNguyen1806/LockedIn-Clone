import Link from "next/link";

export default function HomePage() {
  return (
    <div className="grid">
      <section className="card">
        <h2>Interview copilot MVP</h2>
        <p className="muted">
          Create a session here, then open the desktop overlay to get live coaching during your
          interview or meeting.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link className="btn" href="/register">
            Get started
          </Link>
          <Link className="btn secondary" href="/sessions/new">
            Create session
          </Link>
        </div>
      </section>
      <div className="grid grid-2">
        <div className="card">
          <h3>Before the call</h3>
          <p className="muted">Upload your resume and job description, then configure tone and mode.</p>
        </div>
        <div className="card">
          <h3>During the call</h3>
          <p className="muted">Use the desktop overlay for live transcript and coaching suggestions.</p>
        </div>
        <div className="card">
          <h3>After the call</h3>
          <p className="muted">Review transcript, summary, and feedback bullets in session history.</p>
        </div>
      </div>
    </div>
  );
}
