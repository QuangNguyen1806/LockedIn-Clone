import { useEffect, useState } from "react";
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

export function HomePage() {
  const navigate = useNavigate();
  const [favoritePresets, setFavoritePresets] = useState<Preset[]>([]);
  const [startingId, setStartingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listPresets()
      .then((list) => setFavoritePresets((list as Preset[]).filter((preset) => preset.isFavorite)))
      .catch(() => undefined);
  }, []);

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
        <h2>Welcome to LockedIn Copilot</h2>
        <p className="muted">
          Everything runs in this app — profile setup, sessions, live coaching, and post-session review.
        </p>
        <div className="controls">
          <Link className="btn primary" to="/sessions/new">
            Create session
          </Link>
          <Link className="btn secondary" to="/coach">
            Open live coach
          </Link>
          <Link className="btn secondary" to="/presets">
            Presets
          </Link>
        </div>
      </section>

      {favoritePresets.length > 0 && (
        <section className="card">
          <h3>Favorite presets</h3>
          <p className="muted">Start coaching in one click from a saved configuration.</p>
          <ul className="session-list">
            {favoritePresets.map((preset) => (
              <li key={preset.id}>
                <strong>{preset.name}</strong>
                <div className="muted">
                  {preset.mode} · {preset.tone}
                  {preset.company ? ` · ${preset.company}` : ""}
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
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h3>1. Setup</h3>
          <p className="muted">Upload resume and job description in Profile.</p>
        </div>
        <div className="card">
          <h3>2. Live coach</h3>
          <p className="muted">Speak questions and get real-time Gemini answers.</p>
        </div>
        <div className="card">
          <h3>3. Review</h3>
          <p className="muted">Check transcript and feedback in History.</p>
        </div>
      </div>
      <section className="card">
        <h3>Backend required</h3>
        <p className="muted">
          Start the API once in a terminal: <code>npm run dev:api</code> from the project folder.
        </p>
      </section>
    </div>
  );
}
