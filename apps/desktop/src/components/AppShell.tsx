import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Nav } from "../components/Nav";
import { getStoredToken } from "../lib/api";

export function AppShell() {
  const token = getStoredToken();
  const location = useLocation();

  if (!token && location.pathname !== "/login" && location.pathname !== "/register") {
    return <Navigate to="/login" replace />;
  }

  if (token && (location.pathname === "/login" || location.pathname === "/register")) {
    return <Navigate to="/" replace />;
  }

  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  return (
    <div className={`app-shell ${isAuthPage ? "auth-page" : ""}`}>
      {!isAuthPage && <Nav />}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
