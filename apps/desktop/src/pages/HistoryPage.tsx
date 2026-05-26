import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Session = { id: string; title: string; status: string; createdAt: string };

export function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [metrics, setMetrics] = useState({ totalSessions: 0, completedSessions: 0, totalDurationMinutes: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listSessions(), api.metrics()])
      .then(([list, m]) => {
        setSessions(list as Session[]);
        setMetrics(m);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history"));
  }, []);

  return (
    <div className="grid">
      {error && <p className="error">{error}</p>}
      <section className="card grid grid-2">
        <div>
          <h3>Total sessions</h3>
          <p>{metrics.totalSessions}</p>
        </div>
        <div>
          <h3>Completed</h3>
          <p>{metrics.completedSessions}</p>
        </div>
        <div>
          <h3>Total minutes</h3>
          <p>{metrics.totalDurationMinutes}</p>
        </div>
      </section>
      <section className="card">
        <h2>Session history</h2>
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link to={`/history/${session.id}`}>{session.title}</Link>{" "}
              <span className="badge">{session.status}</span>
              <div className="muted">{new Date(session.createdAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
