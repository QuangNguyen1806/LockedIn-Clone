import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppShell } from "./components/AppShell";
import { CoachPage } from "./pages/CoachPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { OverlayPage } from "./pages/OverlayPage";
import { PresetsPage } from "./pages/PresetsPage";
import { PracticePage } from "./pages/PracticePage";
import { ProfilePage } from "./pages/ProfilePage";
import { RegisterPage } from "./pages/RegisterPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { initCoachBus } from "./stores/sessionStore";

export default function App() {
  useEffect(() => {
    try {
      const window = getCurrentWebviewWindow();
      if (window.label === "main") {
        void initCoachBus();
      }
    } catch {
      // browser dev fallback
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/overlay" element={<OverlayPage />} />
        <Route element={<AppShell />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/presets" element={<PresetsPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/sessions/new" element={<NewSessionPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<SessionDetailPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
