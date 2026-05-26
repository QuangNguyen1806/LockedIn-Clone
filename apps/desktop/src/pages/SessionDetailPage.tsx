import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

type SessionDetail = {
  id: string;
  title: string;
  status: string;
  transcript: Array<{ speaker: string; text: string }>;
  aiOutputs: Array<{ kind: string; content: string; createdAt: string }>;
  summary?: { summary: string; questions: string[]; feedbackBullets: string[] };
};

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);

  async function load() {
    const data = (await api.getSession(id)) as SessionDetail;
    setSession(data);
    setPolling(data.status === "completed" && !data.summary);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load session"));
  }, [id]);

  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(() => {
      load().catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [polling, id]);

  if (!session) return <p className="muted">Loading session...</p>;

  const questionCount = session.transcript.filter((line) => line.speaker === "interviewer").length;

  async function exportTranscript() {
    if (!session) return;
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${session.title.replace(/\s+/g, "-").toLowerCase()}-transcript.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>{session.title}</h2>
        <p className="muted">
          Status: <span className="badge">{session.status}</span> · Questions detected: {questionCount}
        </p>
        <div className="controls">
          {session.status !== "completed" && (
            <button type="button" className="primary" onClick={() => void api.endSession(id).then(load)}>
              End session & generate summary
            </button>
          )}
          <Link className="btn secondary" to={`/coach?session=${session.id}`}>
            Open in live coach
          </Link>
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
          <button type="button" className="secondary" onClick={() => void exportTranscript()}>
            Export JSON
          </button>
          <button
            type="button"
            onClick={() =>
              void api.deleteSession(id).then(() => {
                window.location.href = "/history";
              })
            }
          >
            Delete session
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {session.status === "completed" && !session.summary && (
        <section className="card">
          <p className="muted">Summary pending… generating recap.</p>
        </section>
      )}

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

      {session.aiOutputs.length > 0 && (
        <section className="card">
          <h3>AI outputs</h3>
          {session.aiOutputs.map((output, idx) => (
            <div key={idx} className="grid">
              <span className="badge">{output.kind}</span>
              <pre>{output.content}</pre>
            </div>
          ))}
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
