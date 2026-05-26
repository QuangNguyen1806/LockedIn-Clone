import { Link, useLocation } from "react-router-dom";
import { clearStoredToken } from "../lib/api";

const links = [
  { to: "/", label: "Home" },
  { to: "/profile", label: "Profile" },
  { to: "/sessions/new", label: "New Session" },
  { to: "/history", label: "History" },
  { to: "/coach", label: "Live Coach" },
];

export function Nav() {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <div className="brand">
        <strong>LockedIn</strong>
        <span>Copilot</span>
      </div>
      <nav>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={location.pathname === link.to || location.pathname.startsWith(`${link.to}/`) ? "active" : ""}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <p className="hint">Tray icon: click to show/hide</p>
        <p className="hint">⌘⇧Q quit · ⌘⇧W hide</p>
        <button
          className="secondary"
          onClick={() => {
            clearStoredToken();
            window.location.href = "/login";
          }}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
