const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lockedin_token");
}

export function setToken(token: string) {
  localStorage.setItem("lockedin_token", token);
}

export function clearToken() {
  localStorage.removeItem("lockedin_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
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
  startSession: (id: string) => request(`/api/sessions/${id}/start`, { method: "POST" }),
  endSession: (id: string) => request(`/api/sessions/${id}/end`, { method: "POST" }),
  deleteSession: (id: string) => request(`/api/sessions/${id}`, { method: "DELETE" }),
  metrics: () => request<{ totalSessions: number; completedSessions: number; totalDurationMinutes: number }>("/api/sessions/metrics"),
  listDocuments: () => request<Array<Record<string, unknown>>>("/api/documents"),
  uploadDocument: (kind: string, file: File) => {
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    return request("/api/documents", { method: "POST", body: form });
  },
  deleteDocument: (id: string) => request(`/api/documents/${id}`, { method: "DELETE" }),
};

export { API_URL };
