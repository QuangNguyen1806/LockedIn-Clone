"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";

type SessionDetail = {
  id: string;
  title: string;
  status: string;
  config: { mode: string; company?: string; role?: string; tone: string };
  transcript: Array<{ speaker: string; text: string; createdAt: string }>;
  aiOutputs: Array<{ content: string; kind: string }>;
  summary?: { summary: string; questions: string[]; feedbackBullets: string[] };
};

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const data = (await api.getSession(params.id)) as SessionDetail;
    setSession(data);
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load session"));
  }, [params.id, router]);

  async function endSession() {
    await api.endSession(params.id);
    await load();
  }

  if (!session) return <p className="muted">Loading session...</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>{session.title}</h2>
        <p className="muted">
          {session.config.mode} · {session.config.tone} · <span className="badge">{session.status}</span>
        </p>
        <p className="muted">Session ID for desktop app: {session.id}</p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {session.status !== "completed" && (
            <button type="button" onClick={endSession}>
              End session & generate summary
            </button>
          )}
          <button type="button" className="secondary" onClick={() => load()}>
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

      <section className="card grid">
        <h3>Transcript</h3>
        {session.transcript.length === 0 ? (
          <p className="muted">No transcript yet. Run the desktop overlay to capture audio.</p>
        ) : (
          session.transcript.map((line, idx) => (
            <div key={idx}>
              <strong>{line.speaker}</strong>: {line.text}
            </div>
          ))
        )}
      </section>

      <section className="card grid">
        <h3>AI suggestions</h3>
        {session.aiOutputs.map((output, idx) => (
          <pre key={idx} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {output.content}
          </pre>
        ))}
      </section>
    </div>
  );
}
