"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";

type Session = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [metrics, setMetrics] = useState({ totalSessions: 0, completedSessions: 0, totalDurationMinutes: 0 });

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    Promise.all([api.listSessions(), api.metrics()])
      .then(([list, m]) => {
        setSessions(list as Session[]);
        setMetrics(m);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  return (
    <div className="grid">
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
      </section>

      <section className="card">
        <h2>Session history</h2>
        <ul>
          {sessions.map((session) => (
            <li key={session.id} style={{ marginBottom: "0.75rem" }}>
              <Link href={`/history/${session.id}`}>{session.title}</Link>{" "}
              <span className="badge">{session.status}</span>
              <div className="muted">{new Date(session.createdAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
