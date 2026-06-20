"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AuthCallback() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    const user  = params.get("user");

    if (token) {
      localStorage.setItem("token", token);
      document.cookie = `token=${token}; path=/; max-age=${7 * 24 * 3600}; samesite=lax`;
    }
    if (user) {
      try { localStorage.setItem("user", user); } catch {}
    }

    // убираем токен из адресной строки и переходим на главную
    router.replace("/");
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
