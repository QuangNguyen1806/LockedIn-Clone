import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export function NewSessionPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("Practice interview");
  const [mode, setMode] = useState("behavioral");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [tone, setTone] = useState("conversational");
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const session = (await api.createSession({
        title,
        config: { mode, company, role, tone, customInstructions },
      })) as { id: string };
      navigate(`/history/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    }
  }

  return (
    <div className="card">
      <h2>New session</h2>
      <form onSubmit={onSubmit} className="grid">
        <div>
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="grid grid-2">
          <div>
            <label htmlFor="mode">Mode</label>
            <select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="behavioral">Behavioral interview</option>
              <option value="meeting">Professional meeting</option>
              <option value="technical">Technical interview</option>
            </select>
          </div>
          <div>
            <label htmlFor="tone">Tone</label>
            <select id="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="concise">Concise</option>
              <option value="conversational">Conversational</option>
              <option value="star">STAR structured</option>
            </select>
          </div>
        </div>
        <div className="grid grid-2">
          <div>
            <label htmlFor="company">Company</label>
            <input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label htmlFor="role">Role</label>
            <input id="role" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="instructions">Custom instructions</label>
          <textarea
            id="instructions"
            rows={4}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary">
          Create session
        </button>
      </form>
    </div>
  );
}
