"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearToken, getToken } from "@/lib/auth";

export function Nav() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(!!getToken());
  }, []);

  return (
    <header>
      <h1 style={{ marginBottom: "0.25rem" }}>LockedIn Copilot</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Configure sessions in the web app. Run live coaching in the desktop overlay.
      </p>
      <nav>
        <Link href="/">Home</Link>
        {loggedIn ? (
          <>
            <Link href="/profile">Profile</Link>
            <Link href="/sessions/new">New Session</Link>
            <Link href="/history">History</Link>
            <button
              className="secondary"
              onClick={() => {
                clearToken();
                window.location.href = "/login";
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login">Login</Link>
            <Link href="/register">Register</Link>
          </>
        )}
      </nav>
    </header>
  );
}
