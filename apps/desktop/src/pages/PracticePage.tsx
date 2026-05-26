import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useCoachState } from "../hooks/useCoachState";
import {
  isSystemAudioSupported,
  prepareCoachCapture,
  startCoachSession,
  stopCoachSession,
} from "../stores/sessionStore";

type PracticeQuestion = {
  id: string;
  topic: string;
  difficulty: string;
  text: string;
};

export function PracticePage() {
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<PracticeQuestion | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState("");
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
    try {
      const session = (await api.createSession({
        title: `Practice: ${selectedQuestion.topic}`,
        config: {
          mode: "behavioral",
          tone: "star",
          customInstructions: `Practice question: ${selectedQuestion.text}`,
        },
        strategy: "critique",
      })) as { id: string };
      setSessionId(session.id);
      await prepareCoachCapture(isSystemAudioSupported() ? "mic" : "mic");
      await invoke("show_overlay");
      await startCoachSession({
        sessionId: session.id,
        sessionTitle: `Practice: ${selectedQuestion.topic}`,
        sessionMode: "behavioral",
        sessionStrategy: "critique",
        audioInput: "mic",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start practice session.");
      try {
        await invoke("hide_overlay");
      } catch {
        // ignore
      }
    }
  }

  async function stopPractice() {
    await stopCoachSession();
    try {
      await invoke("hide_overlay");
    } catch {
      // ignore
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
            <button type="button" className="primary" disabled={!selectedQuestion} onClick={() => void startPractice()}>
              Start practice
            </button>
          ) : (
            <button type="button" onClick={() => void stopPractice()}>
              Stop practice
            </button>
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
