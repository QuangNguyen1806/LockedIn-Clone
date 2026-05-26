import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { startLiveCoach } from "../lib/startLiveCoach";
import { useCoachState } from "../hooks/useCoachState";
import { stopCoachSession } from "../stores/sessionStore";

type PracticeQuestion = {
  id: string;
  topic: string;
  difficulty: string;
  text: string;
};

export function PracticePage() {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<PracticeQuestion | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const coach = useCoachState();
  const active = coach.fsmState !== "idle" && coach.fsmState !== "ended";

  useEffect(() => {
    api
      .listPracticeQuestions()
      .then((list) => setQuestions(list as PracticeQuestion[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load questions"));
  }, []);

  async function startPractice() {
    if (!selectedQuestion) {
      setError("Select a practice question first.");
      return;
    }
    setError("");
    setStarting(true);
    try {
      const id = await startLiveCoach({
        title: `Practice: ${selectedQuestion.topic}`,
        config: {
          mode: "behavioral",
          tone: "star",
          customInstructions: `Practice question: ${selectedQuestion.text}`,
        },
        strategy: "critique",
        practiceQuestion: selectedQuestion.text,
        audioInput: "mic",
        visualProfile: "focused",
        navigate: (path) => navigate(path),
      });
      setSessionId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start practice session.");
    } finally {
      setStarting(false);
    }
  }

  async function stopPractice() {
    const endedSessionId = sessionId || coach.sessionId;
    await stopCoachSession();
    if (endedSessionId) {
      try {
        await api.endSession(endedSessionId);
      } catch {
        // summary may already be queued from WS stop
      }
      navigate(`/history/${endedSessionId}`);
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>Practice mode</h2>
        <p className="muted">
          Pick a question, speak your answer aloud, and get critique-style feedback in the overlay.
        </p>
      </section>

      <section className="card grid">
        <div>
          <label htmlFor="practiceQuestion">Question bank</label>
          <select
            id="practiceQuestion"
            value={selectedQuestion?.id || ""}
            onChange={(e) => {
              const q = questions.find((item) => item.id === e.target.value) || null;
              setSelectedQuestion(q);
            }}
            disabled={active}
          >
            <option value="">Select a question</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                [{q.difficulty}] {q.topic}: {q.text.slice(0, 80)}
              </option>
            ))}
          </select>
        </div>
        {selectedQuestion && (
          <div className="card">
            <h3>{selectedQuestion.topic}</h3>
            <p>{selectedQuestion.text}</p>
            <span className="badge">{selectedQuestion.difficulty}</span>
          </div>
        )}
        <div className="controls">
          {!active ? (
            <button
              type="button"
              className="primary"
              disabled={!selectedQuestion || starting}
              onClick={() => void startPractice()}
            >
              {starting ? "Starting…" : "Start practice"}
            </button>
          ) : (
            <button type="button" onClick={() => void stopPractice()}>
              Stop practice
            </button>
          )}
          {sessionId && (
            <Link className="btn secondary" to={`/history/${sessionId}`}>
              View session
            </Link>
          )}
          {sessionId && <span className="badge">{coach.fsmState}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {active && coach.suggestion && (
        <section className="card">
          <h3>Latest feedback</h3>
          <pre>{coach.suggestion}</pre>
        </section>
      )}
    </div>
  );
}
