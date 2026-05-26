import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Session = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  config?: { mode?: string; company?: string; role?: string; tone?: string };
  questionCount?: number;
};

export function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [metrics, setMetrics] = useState({
    totalSessions: 0,
    completedSessions: 0,
    totalDurationMinutes: 0,
    avgDuration: 0,
    questionsAnswered: 0,
    sessionsByWeek: [] as Array<{ weekStart: string; count: number }>,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listSessions(), api.metrics()])
      .then(([list, m]) => {
        setSessions(list as Session[]);
        setMetrics(m);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load history"));
  }, []);

  const filtered = useMemo(() => {
    return sessions.filter((session) => {
      if (statusFilter !== "all" && session.status !== statusFilter) return false;
      if (modeFilter !== "all" && session.config?.mode !== modeFilter) return false;
      const created = new Date(session.createdAt).getTime();
      if (dateFrom && created < new Date(dateFrom).getTime()) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (created > end.getTime()) return false;
      }
      return true;
    });
  }, [dateFrom, dateTo, modeFilter, sessions, statusFilter]);

  function sessionDurationMinutes(session: Session) {
    if (!session.startedAt || !session.endedAt) return null;
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.endedAt).getTime();
    return Math.max(0, Math.round((end - start) / 60000));
  }

  return (
    <div className="grid">
      {error && <p className="error">{error}</p>}
      <section className="card grid grid-2">
        <div>
          <h3>Total sessions</h3>
          <p>{metrics.totalSessions}</p>
        </div>
        <div>
          <h3>Completed</h3>
          <p>{metrics.completedSessions}</p>
        </div>
        <div>
          <h3>Total minutes</h3>
          <p>{metrics.totalDurationMinutes}</p>
        </div>
        <div>
          <h3>Avg duration</h3>
          <p>{metrics.avgDuration} min</p>
        </div>
        <div>
          <h3>Questions answered</h3>
          <p>{metrics.questionsAnswered}</p>
        </div>
      </section>

      {metrics.sessionsByWeek.length > 0 && (
        <section className="card">
          <h3>Sessions by week</h3>
          <ul>
            {metrics.sessionsByWeek.map((week) => (
              <li key={week.weekStart}>
                Week of {week.weekStart}: {week.count}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card grid">
        <h2>Session history</h2>
        <div className="grid grid-2">
          <div>
            <label htmlFor="statusFilter">Status</label>
            <select id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label htmlFor="modeFilter">Mode</label>
            <select id="modeFilter" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="behavioral">Behavioral</option>
              <option value="technical">Technical</option>
              <option value="meeting">Meeting</option>
            </select>
          </div>
          <div>
            <label htmlFor="dateFrom">From</label>
            <input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dateTo">To</label>
            <input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        <ul className="session-list">
          {filtered.map((session) => {
            const duration = sessionDurationMinutes(session);
            const meta = [session.config?.company, session.config?.role, session.config?.tone]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={session.id}>
                <Link to={`/history/${session.id}`}>{session.title}</Link>{" "}
                <span className="badge">{session.status}</span>
                {session.config?.mode && <span className="badge">{session.config.mode}</span>}
                {(session.questionCount ?? 0) > 0 && (
                  <span className="badge">{session.questionCount} Q&A</span>
                )}
                {duration !== null && <span className="badge">{duration} min</span>}
                <div className="muted">
                  {new Date(session.createdAt).toLocaleString()}
                  {meta ? ` · ${meta}` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
