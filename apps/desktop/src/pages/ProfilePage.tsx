import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

type Profile = {
  displayName: string;
  headline?: string;
  skills: string[];
  deleteDataOnSessionEnd?: boolean;
};

type Document = {
  id: string;
  kind: string;
  filename: string;
  parseStatus: string;
};

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [skillsText, setSkillsText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.me(), api.listDocuments()])
      .then(([me, docs]) => {
        const p = me as Profile;
        setProfile(p);
        setSkillsText((p.skills || []).join(", "));
        setDocuments(docs as Document[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load profile"));
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError("");
    try {
      const updated = (await api.updateProfile({
        displayName: profile.displayName,
        headline: profile.headline,
        skills: skillsText.split(",").map((s) => s.trim()).filter(Boolean),
        deleteDataOnSessionEnd: profile.deleteDataOnSessionEnd,
      })) as Profile;
      setProfile(updated);
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function upload(kind: "resume" | "job_description", file: File | null) {
    if (!file) return;
    setError("");
    try {
      await api.uploadDocument(kind, file);
      const docs = (await api.listDocuments()) as Document[];
      setDocuments(docs);
      setMessage(`${kind} uploaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function retryParse(documentId: string) {
    setError("");
    try {
      await api.reparseDocument(documentId);
      const docs = (await api.listDocuments()) as Document[];
      setDocuments(docs);
      setMessage("Document queued for parsing.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  if (!profile) return <p className="muted">Loading profile...</p>;

  return (
    <div className="grid">
      <section className="card">
        <h2>Profile</h2>
        <form onSubmit={saveProfile} className="grid">
          <div>
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              value={profile.displayName}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="headline">Headline</label>
            <input
              id="headline"
              value={profile.headline || ""}
              onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="skills">Skills</label>
            <input id="skills" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
          </div>
          <label className="controls">
            <input
              type="checkbox"
              checked={Boolean(profile.deleteDataOnSessionEnd)}
              onChange={(e) => setProfile({ ...profile, deleteDataOnSessionEnd: e.target.checked })}
            />
            Delete transcript data when a session ends
          </label>
          {message && <p className="muted">{message}</p>}
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary">
            Save profile
          </button>
        </form>
      </section>
      <section className="card grid">
        <h2>Documents</h2>
        <div>
          <label htmlFor="resume">Upload resume</label>
          <input id="resume" type="file" onChange={(e) => upload("resume", e.target.files?.[0] || null)} />
        </div>
        <div>
          <label htmlFor="jd">Upload job description</label>
          <input id="jd" type="file" onChange={(e) => upload("job_description", e.target.files?.[0] || null)} />
        </div>
        <ul>
          {documents.map((doc) => (
            <li key={doc.id}>
              {doc.filename} <span className="badge">{doc.kind}</span>{" "}
              <span className="badge">{doc.parseStatus}</span>
              {doc.parseStatus === "failed" && (
                <button type="button" className="secondary" onClick={() => void retryParse(doc.id)}>
                  Retry parse
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="hint">Parsing runs in the background worker. Start it with: npm run dev:worker</p>
      </section>
    </div>
  );
}
