const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

export function getStoredToken(): string {
  return localStorage.getItem("lockedin_token") || "";
}

export function setStoredToken(token: string) {
  localStorage.setItem("lockedin_token", token);
}

export function clearStoredToken() {
  localStorage.removeItem("lockedin_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Load failed" || msg === "Failed to fetch" || err instanceof TypeError) {
      throw new Error(
        `Cannot reach the API at ${API_URL}. Start the backend with: npm run dev:api`,
      );
    }
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Request failed");
  }
  return res.json();
}

export const api = {
  register: (body: { email: string; password: string; displayName: string }) =>
    request<{ accessToken: string; user: unknown }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    request<{ accessToken: string; user: unknown }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => request("/api/auth/me"),
  updateProfile: (body: Record<string, unknown>) =>
    request("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) }),
  listSessions: () => request<Array<Record<string, unknown>>>("/api/sessions"),
  getSession: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}`),
  createSession: (body: Record<string, unknown>) =>
    request("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  endSession: (id: string) => request(`/api/sessions/${id}/end`, { method: "POST" }),
  metrics: () =>
    request<{ totalSessions: number; completedSessions: number; totalDurationMinutes: number }>(
      "/api/sessions/metrics",
    ),
  listDocuments: () => request<Array<Record<string, unknown>>>("/api/documents"),
  uploadDocument: (kind: string, file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return request("/api/documents", { method: "POST", body: form });
  },
};

export function buildWsUrl(sessionId: string, token: string) {
  return `${WS_URL}/ws/sessions/${sessionId}?token=${encodeURIComponent(token)}`;
}

export { API_URL, WS_URL };
