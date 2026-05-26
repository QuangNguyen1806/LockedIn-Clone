import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { startLiveCoach } from "../lib/startLiveCoach";

type Preset = {
  id: string;
  name: string;
  mode: string;
  tone: string;
  company?: string;
  role?: string;
  customInstructions?: string;
};

export function NewSessionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState("Practice interview");
  const [mode, setMode] = useState("behavioral");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [tone, setTone] = useState("conversational");
  const [customInstructions, setCustomInstructions] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetId, setPresetId] = useState(searchParams.get("preset") || "");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .listPresets()
      .then((list) => setPresets(list as Preset[]))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const selected = presets.find((preset) => preset.id === presetId);
    if (!selected) return;
    setTitle(selected.name);
    setMode(selected.mode);
    setTone(selected.tone);
    setCompany(selected.company || "");
    setRole(selected.role || "");
    setCustomInstructions(selected.customInstructions || "");
  }, [presetId, presets]);

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

  async function onCreateAndStart(e: FormEvent) {
    e.preventDefault();
    setError("");
    setStarting(true);
    try {
      await startLiveCoach({
        title,
        config: { mode, company, role, tone, customInstructions },
        navigate: (path) => navigate(path),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start coaching");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="card">
      <h2>New session</h2>
      <form onSubmit={onSubmit} className="grid">
        {presets.length > 0 && (
          <div>
            <label htmlFor="preset">Start from preset</label>
            <select id="preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">Custom session</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
        )}
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
        <div className="controls">
          <button type="submit" className="secondary">
            Create session
          </button>
          <button type="button" className="primary" disabled={starting} onClick={(e) => void onCreateAndStart(e)}>
            {starting ? "Starting…" : "Create & start coaching"}
          </button>
        </div>
      </form>
    </div>
  );
}
