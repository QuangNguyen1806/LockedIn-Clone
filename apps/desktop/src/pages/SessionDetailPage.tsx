import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

type SessionDetail = {
  id: string;
  title: string;
  status: string;
  transcript: Array<{ speaker: string; text: string }>;
  aiOutputs: Array<{ content: string }>;
  summary?: { summary: string; questions: string[]; feedbackBullets: string[] };
};

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const data = (await api.getSession(id)) as SessionDetail;
    setSession(data);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load session"));
  }, [id]);

  if (!session) return <p className="muted">Loading session...</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>{session.title}</h2>
        <p className="muted">
          Status: <span className="badge">{session.status}</span>
        </p>
        <div className="controls">
          {session.status !== "completed" && (
            <button
              type="button"
              className="primary"
              onClick={() => void api.endSession(id).then(load)}
            >
              End session & generate summary
            </button>
          )}
          <Link className="btn secondary" to={`/coach?session=${session.id}`}>
            Open in live coach
          </Link>
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
      {session.summary && (
        <section className="card grid">
          <h3>Summary</h3>
          <p>{session.summary.summary}</p>
          <div>
            <h4>Questions</h4>
            <ul>
              {session.summary.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Feedback</h4>
            <ul>
              {session.summary.feedbackBullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <section className="card">
        <h3>Transcript</h3>
        {session.transcript.length === 0 ? (
          <p className="muted">No transcript yet.</p>
        ) : (
          session.transcript.map((line, idx) => (
            <div key={idx}>
              <strong>{line.speaker}</strong>: {line.text}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
