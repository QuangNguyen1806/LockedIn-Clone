import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { startLiveCoach } from "../lib/startLiveCoach";

type Preset = {
  id: string;
  name: string;
  isFavorite: boolean;
  mode: string;
  tone: string;
  company?: string;
  role?: string;
  customInstructions?: string;
};

export function PresetsPage() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("behavioral");
  const [tone, setTone] = useState("conversational");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState("");

  async function load() {
    const list = (await api.listPresets()) as Preset[];
    setPresets(list);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load presets"));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createPreset({ name, mode, tone, company, role, customInstructions, isFavorite: false });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create preset");
    }
  }

  async function toggleFavorite(preset: Preset) {
    await api.updatePreset(preset.id, { isFavorite: !preset.isFavorite });
    await load();
  }

  async function removePreset(id: string) {
    await api.deletePreset(id);
    await load();
  }

  async function handleStartCoaching(preset: Preset) {
    setError("");
    setStartingId(preset.id);
    try {
      await startLiveCoach({
        title: preset.name,
        config: {
          mode: preset.mode,
          tone: preset.tone,
          company: preset.company,
          role: preset.role,
          customInstructions: preset.customInstructions,
        },
        navigate: (path) => navigate(path),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start coaching");
    } finally {
      setStartingId("");
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>Session presets</h2>
        <p className="muted">Save interview configurations and start sessions quickly.</p>
        <form onSubmit={onCreate} className="grid">
          <div>
            <label htmlFor="presetName">Name</label>
            <input id="presetName" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-2">
            <div>
              <label htmlFor="presetMode">Mode</label>
              <select id="presetMode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="behavioral">Behavioral</option>
                <option value="technical">Technical</option>
                <option value="meeting">Meeting</option>
              </select>
            </div>
            <div>
              <label htmlFor="presetTone">Tone</label>
              <select id="presetTone" value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="concise">Concise</option>
                <option value="conversational">Conversational</option>
                <option value="star">STAR</option>
              </select>
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <label htmlFor="presetCompany">Company</label>
              <input id="presetCompany" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div>
              <label htmlFor="presetRole">Role</label>
              <input id="presetRole" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="presetInstructions">Custom instructions</label>
            <textarea
              id="presetInstructions"
              rows={3}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
            />
          </div>
          <button type="submit" className="primary">
            Save preset
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h3>Your presets</h3>
        <ul className="session-list">
          {presets.map((preset) => (
            <li key={preset.id}>
              <strong>{preset.name}</strong> {preset.isFavorite && <span className="badge">★</span>}
              <div className="muted">
                {preset.mode} · {preset.tone}
                {preset.company ? ` · ${preset.company}` : ""}
                {preset.role ? ` · ${preset.role}` : ""}
              </div>
              <div className="controls">
                <button
                  type="button"
                  className="primary"
                  disabled={startingId === preset.id}
                  onClick={() => void handleStartCoaching(preset)}
                >
                  {startingId === preset.id ? "Starting…" : "Start coaching"}
                </button>
                <Link className="btn secondary" to={`/sessions/new?preset=${preset.id}`}>
                  New session
                </Link>
                <button type="button" className="secondary" onClick={() => void toggleFavorite(preset)}>
                  {preset.isFavorite ? "Unfavorite" : "Favorite"}
                </button>
                <button type="button" onClick={() => void removePreset(preset.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
