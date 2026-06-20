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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--ink)" }}>
      <p style={{ color: "var(--muted)" }}>Загрузка…</p>
    </div>
  );

  const isAdmin = user.role === "admin";

  return (
    <div style={{ minHeight: "100vh", background: "var(--ink)", padding: "0 0 60px" }}>
      {/* topbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 24px", borderBottom: "1px solid var(--line)",
        background: "linear-gradient(var(--ink) 70%, transparent)",
        position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(6px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13 }}>
            ← Терминал
          </Link>
          <span style={{ fontFamily: "var(--display)", fontWeight: 600, letterSpacing: "0.12em", fontSize: 16, textTransform: "uppercase" }}>
            Профиль
          </span>
        </div>
        <button onClick={logout} style={{
          background: "var(--short-dim)", border: "1px solid #5c2730",
          color: "var(--short)", borderRadius: 8, padding: "7px 16px",
          fontSize: 13, cursor: "pointer", fontWeight: 600,
        }}>
          Выйти из аккаунта
        </button>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Информация об аккаунте */}
        <div className="card">
          <h2>Аккаунт</h2>
          <p className="sub">Ваши данные в системе Mantra Trading</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              ["Имя", user.name || "—"],
              ["Email", user.email],
              ["Роль", isAdmin ? "Администратор" : "Пользователь"],
              ["Дата регистрации", user.created_at
                ? new Date(user.created_at).toLocaleDateString("ru-RU")
                : "—"],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Квота AI */}
          {quota && (
            <div style={{
              marginTop: 14, background: "var(--ink)", border: "1px solid var(--line)",
              borderRadius: 10, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                AI-аналитика
              </div>
              {isAdmin ? (
                <div style={{ fontSize: 13, color: "var(--long)" }}>Без ограничений (admin)</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
                    Использовано {quota.used} из {quota.limit} запросов в этом месяце
                  </div>
                  <div style={{ height: 6, background: "var(--ink-2)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      background: quota.remaining === 0 ? "var(--short)" : "var(--primary)",
                      width: `${Math.min(100, (quota.used / quota.limit) * 100)}%`,
                      transition: "width .3s",
                    }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    Осталось: {quota.remaining ?? 0}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Смена пароля */}
        <div className="card">
          <h2>Смена пароля</h2>
          <p className="sub">Минимум 6 символов. Будьте осторожны — изменение немедленно вступает в силу.</p>

          <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pwMsg && (
              <div style={{ background: "rgba(45,212,167,.1)", border: "1px solid rgba(45,212,167,.3)", color: "var(--long)", borderRadius: 9, padding: "10px 14px", fontSize: 14 }}>
                {pwMsg}
              </div>
            )}
            {pwErr && <div className="error">{pwErr}</div>}

            <div className="field">
              <label>Текущий пароль</label>
              <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)}
                placeholder="Введите текущий пароль" required />
            </div>
            <div className="field">
              <label>Новый пароль</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="Новый пароль (мин. 6 символов)" required />
            </div>
            <div className="field">
              <label>Повторите новый пароль</label>
              <input type="password" value={confPw} onChange={e => setConfPw(e.target.value)}
                placeholder="Повторите новый пароль" required />
            </div>
            <button type="submit" className="btn" disabled={pwLoading}>
              {pwLoading ? "Сохранение…" : "Сменить пароль"}
            </button>
          </form>
        </div>

        {/* Опасная зона */}
        <div className="card" style={{ border: "1px solid #5c2730" }}>
          <h2 style={{ color: "var(--short)" }}>Выход</h2>
          <p className="sub">Завершите текущий сеанс и вернитесь на страницу входа.</p>
          <button onClick={logout} className="btn" style={{ background: "var(--short-dim)", border: "1px solid #5c2730", color: "var(--short)" }}>
            Выйти из аккаунта
          </button>
        </div>
      </div>
    </div>
  );
}
