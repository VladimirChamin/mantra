"use client";

import React, { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function apiReq(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${API}${path}`, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Ошибка ${r.status}`);
  return data;
}

// ─── inline-редактор квоты ───────────────────────────────────────────────────
function QuotaEditor({ userId, current, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiReq("PATCH", `/api/auth/users/${userId}`, { ai_quota: +val });
      onSaved();
      setEditing(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontWeight: 600 }}>{current}</span>
      <button onClick={() => { setVal(current); setEditing(true); }}
        style={btnStyle("#4a5568", "#718096")}>✎</button>
    </span>
  );

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" min={0} max={9999}
        value={val} onChange={e => setVal(e.target.value)}
        style={{ width: 60, padding: "2px 6px", borderRadius: 5,
                 border: "1px solid var(--border)", background: "var(--card2, #2d3748)",
                 color: "inherit", fontSize: 13 }} />
      <button onClick={save} disabled={saving}
        style={btnStyle("#276749", "#48bb78")}>✓</button>
      <button onClick={() => setEditing(false)}
        style={btnStyle("#742a2a", "#fc8181")}>✗</button>
    </span>
  );
}

// ─── inline-редактор даты доступа ────────────────────────────────────────────
function AccessEditor({ userId, current, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(
    current ? current.slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      // пустая строка = снять лимит (null)
      const until = val ? `${val}T23:59:59+00:00` : "";
      await apiReq("PATCH", `/api/auth/users/${userId}`, { access_until: until });
      onSaved();
      setEditing(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  const label = current
    ? new Date(current).toLocaleDateString("ru-RU")
    : <span style={{ opacity: 0.4 }}>бессрочно</span>;

  if (!editing) return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {label}
      <button onClick={() => setEditing(true)}
        style={btnStyle("#4a5568", "#718096")}>✎</button>
    </span>
  );

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="date"
        value={val} onChange={e => setVal(e.target.value)}
        style={{ padding: "2px 6px", borderRadius: 5,
                 border: "1px solid var(--border)", background: "var(--card2, #2d3748)",
                 color: "inherit", fontSize: 13 }} />
      <button onClick={save} disabled={saving}
        style={btnStyle("#276749", "#48bb78")}>✓</button>
      <button onClick={() => setEditing(false)}
        style={btnStyle("#742a2a", "#fc8181")}>✗</button>
    </span>
  );
}

// ─── смена роли ───────────────────────────────────────────────────────────────
function RoleSelector({ userId, current, onSaved, selfId }) {
  const [saving, setSaving] = useState(false);
  if (userId === selfId) return (
    <span style={{ opacity: 0.4, fontSize: 12 }}>{current} (вы)</span>
  );

  async function toggle() {
    const next = current === "admin" ? "user" : "admin";
    if (!confirm(`Сменить роль на «${next}»?`)) return;
    setSaving(true);
    try {
      await apiReq("PATCH", `/api/auth/users/${userId}`, { role: next });
      onSaved();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  const isAdmin = current === "admin";
  return (
    <button onClick={toggle} disabled={saving} style={{
      padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600,
      border: "none", cursor: "pointer",
      background: isAdmin ? "var(--accent, #63b3ed)" : "var(--border)",
      color: isAdmin ? "#fff" : "var(--muted2)",
      opacity: saving ? 0.6 : 1,
    }}>
      {current}
    </button>
  );
}

// ─── вспомогательный стиль мини-кнопки ───────────────────────────────────────
function btnStyle(bg, border) {
  return {
    padding: "2px 7px", borderRadius: 5, fontSize: 12,
    border: `1px solid ${border}`, background: bg,
    color: border, cursor: "pointer",
  };
}

// ─── Главный компонент AdminPanel ─────────────────────────────────────────────
export default function AdminPanel({ currentUserId }) {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [search, setSearch]   = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await apiReq("GET", "/api/auth/users");
      setUsers(d.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(u) {
    if (!confirm(`Удалить пользователя ${u.email}? Все его данные будут удалены.`)) return;
    try {
      await apiReq("DELETE", `/api/auth/users/${u.id}`);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  const filtered = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase())
      || u.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalUsers  = users.length;
  const activeToday = users.filter(u => u.access_active).length;
  const totalAiUsed = users.reduce((s, u) => s + (u.ai_used_this_month || 0), 0);

  return (
    <div>
      {/* Сводка */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Всего пользователей", value: totalUsers },
          { label: "Активных", value: activeToday, color: "var(--long, #68d391)" },
          { label: "AI-запросов в месяц", value: totalAiUsed, color: "var(--accent, #63b3ed)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: "1 1 160px", padding: "14px 18px", borderRadius: 10,
            border: "1px solid var(--border)", background: "var(--card2, rgba(255,255,255,.03))",
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: color || "inherit" }}>{value}</div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Поиск */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input
          type="text" placeholder="Поиск по email или имени…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: "8px 14px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--card2, #2d3748)",
            color: "inherit", fontSize: 13,
          }}
        />
        <button onClick={load} style={{
          padding: "8px 16px", borderRadius: 8, fontSize: 13,
          border: "1px solid var(--border)", background: "transparent",
          color: "var(--muted2)", cursor: "pointer",
        }}>↻ Обновить</button>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 14,
                      background: "rgba(252,129,129,.1)", color: "var(--short, #fc8181)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ opacity: 0.5, padding: 20, textAlign: "center" }}>Загрузка…</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ opacity: 0.45, textAlign: "left" }}>
                {["#", "Email / Имя", "Роль", "AI-квота", "Использовано", "Доступ до", "Зарегистрирован", ""].map(h => (
                  <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)",
                                        fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const accessOk = u.access_active;
                return (
                  <tr key={u.id} style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: accessOk ? 1 : 0.5,
                    transition: "background .15s",
                  }}>
                    <td style={{ padding: "10px 10px", opacity: 0.4, fontSize: 11 }}>{u.id}</td>
                    <td style={{ padding: "10px 10px" }}>
                      <div style={{ fontWeight: 600 }}>{u.email}</div>
                      {u.name && <div style={{ fontSize: 11, opacity: 0.5 }}>{u.name}</div>}
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      <RoleSelector
                        userId={u.id} current={u.role}
                        selfId={currentUserId} onSaved={load}
                      />
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      <QuotaEditor userId={u.id} current={u.ai_quota} onSaved={load} />
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "center" }}>
                      <span style={{
                        display: "inline-block", minWidth: 36, padding: "2px 8px",
                        borderRadius: 10, fontSize: 12, fontWeight: 600,
                        background: u.ai_used_this_month >= u.ai_quota
                          ? "rgba(252,129,129,.15)" : "rgba(104,211,145,.1)",
                        color: u.ai_used_this_month >= u.ai_quota
                          ? "var(--short, #fc8181)" : "var(--long, #68d391)",
                      }}>
                        {u.ai_used_this_month}/{u.ai_quota}
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      <AccessEditor userId={u.id} current={u.access_until} onSaved={load} />
                    </td>
                    <td style={{ padding: "10px 10px", opacity: 0.4, fontSize: 11, whiteSpace: "nowrap" }}>
                      {u.created_at?.slice(0, 10) || "—"}
                    </td>
                    <td style={{ padding: "10px 10px" }}>
                      {u.id !== currentUserId && (
                        <button onClick={() => handleDelete(u)} style={{
                          padding: "4px 10px", borderRadius: 6, fontSize: 11,
                          border: "1px solid var(--short, #fc8181)",
                          background: "transparent", color: "var(--short, #fc8181)",
                          cursor: "pointer",
                        }}>Удалить</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", opacity: 0.4 }}>
                    Пользователи не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
