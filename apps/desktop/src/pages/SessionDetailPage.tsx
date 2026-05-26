import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { startLiveCoach } from "../lib/startLiveCoach";

type SessionDetail = {
  id: string;
  title: string;
  status: string;
  config?: { mode?: string; company?: string; role?: string; tone?: string; customInstructions?: string };
  transcript: Array<{ speaker: string; text: string; createdAt?: string }>;
  aiOutputs: Array<{ kind: string; content: string; createdAt: string }>;
  summary?: { summary: string; questions: string[]; feedbackBullets: string[] };
};

function pairQuestionsWithAnswers(session: SessionDetail) {
  const questions = session.transcript.filter((line) => line.speaker === "interviewer");
  const outputs = session.aiOutputs.filter(
    (output) => output.kind === "suggestion" || output.kind === "critique",
  );
  return questions.map((question, index) => ({
    question: question.text,
    answer: outputs[index]?.content || "",
    createdAt: question.createdAt || outputs[index]?.createdAt,
  }));
}

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);

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

  const qaPairs = useMemo(() => (session ? pairQuestionsWithAnswers(session) : []), [session]);

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

  async function handleStartCoaching() {
    if (!session) return;
    setStarting(true);
    setError("");
    try {
      await startLiveCoach({
        sessionId: session.id,
        title: session.title,
        config: {
          mode: session.config?.mode,
          company: session.config?.company,
          role: session.config?.role,
          tone: session.config?.tone,
          customInstructions: session.config?.customInstructions,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start coaching");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>{session.title}</h2>
        <p className="muted">
          Status: <span className="badge">{session.status}</span> · Questions detected: {questionCount}
          {session.config?.company ? ` · ${session.config.company}` : ""}
          {session.config?.role ? ` · ${session.config.role}` : ""}
        </p>
        <div className="controls">
          {session.status !== "completed" && (
            <button type="button" className="primary" onClick={() => void api.endSession(id).then(load)}>
              End session & generate summary
            </button>
          )}
          <button type="button" className="primary" disabled={starting} onClick={() => void handleStartCoaching()}>
            {starting ? "Starting…" : "Start coaching"}
          </button>
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

      {qaPairs.length > 0 && (
        <section className="card">
          <h3>Questions & answers</h3>
          {qaPairs.map((pair, idx) => (
            <div key={idx} className="grid" style={{ marginBottom: "1rem" }}>
              <p>
                <strong>Q:</strong> {pair.question}
              </p>
              <pre>{pair.answer || "(no answer recorded)"}</pre>
            </div>
          ))}
        </section>
      )}

      {session.aiOutputs.length > 0 && qaPairs.length === 0 && (
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
