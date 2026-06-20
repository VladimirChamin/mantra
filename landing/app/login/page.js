"use client";

import { useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка входа");
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      document.cookie = `token=${data.token}; path=/; max-age=${7 * 24 * 3600}; samesite=lax`;
      window.location.href = APP;
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link href="/" style={{ fontSize: 13, color: "var(--muted2)", display: "block", marginBottom: 20 }}>
          ← Mantra Trading
        </Link>
        <h2>Вход в терминал</h2>
        <p className="auth-sub">Введите email и пароль для доступа</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" required
              value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Пароль</label>
            <input type="password" placeholder="••••••••" required
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className="btn-submit" type="submit" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>

        <p className="auth-link">
          Нет аккаунта? <Link href="/register">Зарегистрироваться</Link>
        </p>
      </div>
    </div>
  );
}
