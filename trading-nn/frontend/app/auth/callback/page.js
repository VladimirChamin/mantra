"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function CallbackInner() {
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    const user  = params.get("user");

    if (!token && !user) return;

    if (user) {
      try { localStorage.setItem("user", user); } catch {}
    }

    if (token) {
      localStorage.setItem("token", token);
      window.location.href = `/api/auth/set-cookie?token=${encodeURIComponent(token)}&redirect=/`;
    } else {
      window.location.href = "/";
    }
  }, [params]);

  return null;
}

const Spinner = () => (
  <div style={{
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "var(--ink)",
  }}>
    <span className="spinner" style={{ width: 24, height: 24 }} />
  </div>
);

export default function AuthCallback() {
  return (
    <Suspense fallback={<Spinner />}>
      <Spinner />
      <CallbackInner />
    </Suspense>
  );
}
