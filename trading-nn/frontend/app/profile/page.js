"use client";

import { useState, useEffect } from "react";
import { getUser, logout } from "@/lib/auth";
import { api } from "@/lib/api";
import Link from "next/link";

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [quota, setQuota] = useState(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confPw, setConfPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    if (u) api.aiQuota().then(setQuota).catch(() => {});
  }, []);

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(""); setPwErr("");
    if (newPw !== confPw) { setPwErr("Пароли не совпадают"); return; }
    if (newPw.length < 6) { setPwErr("Минимум 6 символов"); return; }
    setPwLoading(true);
    try {
      await api.changePassword({ current_password: curPw, new_password: newPw });
      setPwMsg("Пароль успешно изменён");
      setCurPw(""); setNewPw(""); setConfPw("");
    } catch (e) {
      setPwErr(e.message);
    }
    setPwLoading(false);
  }

  if (!user) return (
    <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <span className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  );

  const isAdmin = user.role === "admin";
  const quotaPct = quota && !isAdmin ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <div className="shell">

      {/* topbar в стиле терминала */}
      <div className="topbar">
        <div className="brand">
          <Link href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
            ← MANTRA
          </Link>
          <span style={{ color: "var(--muted-2)", fontSize: 13 }}>/</span>
          <h1 style={{ fontSize: 17 }}>Профиль</h1>
        </div>
        <div className="status">
          <button onClick={logout} style={{
            fontSize: 12, padding: "5px 14px", borderRadius: 8,
            border: "1px solid var(--line)", background: "transparent",
            color: "var(--muted)", cursor: "pointer",
          }}>
            Выйти
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18, marginTop: 24 }}>

        {/* ЛЕВАЯ КОЛОНКА */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Аккаунт */}
          <div className="card">
            <h2>Аккаунт</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>

              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: isAdmin ? "var(--primary)" : "var(--line)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700,
                color: isAdmin ? "#fff" : "var(--muted)",
              }}>
                {(user.name || user.email || "?")[0].toUpperCase()}
              </div>

              {[
                ["Имя", user.name || "—"],
                ["Email", user.email],
                ["Роль", isAdmin ? "Администратор" : "Пользователь"],
                ["Регистрация", user.created_at ? new Date(user.created_at).toLocaleDateString("ru-RU") : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI-квота */}
          {quota && (
            <div className="card">
              <h2>AI-анализ</h2>
              <div style={{ marginTop: 12 }}>
                {isAdmin ? (
                  <div style={{ fontSize: 13, color: "var(--long)", fontWeight: 600 }}>∞ Без ограничений</div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>Использовано в этом месяце</span>
                      <span style={{ fontSize: 13, fontFamily: "var(--mono)", fontWeight: 600 }}>{quota.used} / {quota.limit}</span>
                    </div>
                    <div style={{ height: 5, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 4,
                        background: quota.remaining === 0 ? "var(--short)" : "var(--primary)",
                        width: `${quotaPct}%`, transition: "width .3s",
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5 }}>
                      Осталось: <strong style={{ color: quota.remaining === 0 ? "var(--short)" : "var(--long)" }}>{quota.remaining}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Выход */}
          <div className="card" style={{ border: "1px solid var(--short-dim)" }}>
            <h2 style={{ color: "var(--short)" }}>Выход</h2>
            <p className="sub">Завершить текущий сеанс</p>
            <button onClick={logout} className="btn" style={{
              background: "var(--short-dim)", border: "1px solid var(--short)",
              color: "var(--short)",
            }}>
              Выйти из аккаунта
            </button>
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА */}
        <div className="card">
          <h2>Смена пароля</h2>
          <p className="sub">Новый пароль вступает в силу немедленно. Минимум 6 символов.</p>

          <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
            {pwMsg && (
              <div style={{
                background: "var(--long-dim)", border: "1px solid var(--long)",
                color: "var(--long)", borderRadius: 9, padding: "10px 14px", fontSize: 13,
              }}>
                ✓ {pwMsg}
              </div>
            )}
            {pwErr && <div className="error">{pwErr}</div>}

            <div className="field">
              <label>Текущий пароль</label>
              <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="Текущий пароль" required />
            </div>

            <div className="field">
              <label>Новый пароль</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Не менее 6 символов" required />
            </div>

            <div className="field">
              <label>Повторите новый пароль</label>
              <input type="password" value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Повторите пароль" required />
            </div>

            {newPw && confPw && newPw !== confPw && (
              <div style={{ fontSize: 12, color: "var(--short)", marginTop: -6 }}>Пароли не совпадают</div>
            )}
            {newPw && confPw && newPw === confPw && newPw.length >= 6 && (
              <div style={{ fontSize: 12, color: "var(--long)", marginTop: -6 }}>✓ Пароли совпадают</div>
            )}

            <button type="submit" className="btn" disabled={pwLoading}>
              {pwLoading ? "Сохранение…" : "Сменить пароль"}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .profile-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
