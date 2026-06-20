"use client";

import { useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const APP = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function RegisterPage() {
  const [form, setForm] = useState({ email: "", name: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) { setError("Пароли не совпадают"); return; }
    if (form.password.length < 6) { setError("Пароль минимум 6 символов"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, name: form.name, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка регистрации");
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
        <h2>Регистрация</h2>
        <p className="auth-sub">Создайте аккаунт для доступа к терминалу</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>Имя</label>
            <input type="text" placeholder="Иван Иванов" required
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Email</label>
            <input type="email" placeholder="you@example.com" required
              value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Пароль</label>
            <input type="password" placeholder="Минимум 6 символов" required
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="form-field">
            <label>Повторите пароль</label>
            <input type="password" placeholder="••••••••" required
              value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} />
          </div>
          <button className="btn-submit" type="submit" disabled={loading}>
            {loading ? "Регистрация…" : "Создать аккаунт"}
          </button>
        </form>

        <p className="auth-link">
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
