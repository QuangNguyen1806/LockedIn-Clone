import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <div className="grid">
      <section className="card">
        <h2>Welcome to LockedIn Copilot</h2>
        <p className="muted">
          Everything runs in this app — profile setup, sessions, live coaching, and post-session review.
        </p>
        <div className="controls">
          <Link className="btn primary" to="/sessions/new">
            Create session
          </Link>
          <Link className="btn secondary" to="/coach">
            Open live coach
          </Link>
        </div>
      </section>
      <div className="grid grid-2">
        <div className="card">
          <h3>1. Setup</h3>
          <p className="muted">Upload resume and job description in Profile.</p>
        </div>
        <div className="card">
          <h3>2. Live coach</h3>
          <p className="muted">Speak questions and get real-time Gemini answers.</p>
        </div>
        <div className="card">
          <h3>3. Review</h3>
          <p className="muted">Check transcript and feedback in History.</p>
        </div>
      </div>
      <section className="card">
        <h3>Backend required</h3>
        <p className="muted">
          Start the API once in a terminal: <code>npm run dev:api</code> from the project folder.
        </p>
      </section>
    </div>
  );
}
