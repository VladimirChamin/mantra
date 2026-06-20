"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthCallback() {
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    const user  = params.get("user");

    if (user) {
      try { localStorage.setItem("user", user); } catch {}
    }

    if (token) {
      localStorage.setItem("token", token);
      // переходим через API route — он ставит cookie через HTTP Set-Cookie header
      // и редиректит на главную, поэтому middleware увидит cookie сразу
      window.location.href = `/api/auth/set-cookie?token=${encodeURIComponent(token)}&redirect=/`;
    } else {
      window.location.href = "/";
    }
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--ink)",
    }}>
      <span className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  );
}
