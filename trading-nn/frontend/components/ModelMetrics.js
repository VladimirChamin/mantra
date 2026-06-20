"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

// Пороги совпадают с trading_nn.py
const THRESH_OK     = 0.56;
const THRESH_WARN   = 0.54;

function statusColor(status) {
  if (status === "ok")       return "var(--long)";
  if (status === "warn")     return "var(--amber)";
  if (status === "critical") return "var(--short)";
  return "var(--muted)";
}

function statusLabel(status) {
  if (status === "ok")       return "OK";
  if (status === "warn")     return "WARN";
  if (status === "critical") return "КРИТ";
  return "—";
}

function AucBar({ auc }) {
  if (auc == null) return <span style={{ opacity: 0.35, fontSize: 12 }}>нет данных</span>;
  const pct   = Math.max(0, Math.min(100, (auc - 0.48) / (0.72 - 0.48) * 100));
  const color = auc >= THRESH_OK   ? "var(--long)"
              : auc >= THRESH_WARN ? "var(--amber)"
              : "var(--short)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "var(--ink-2)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s" }} />
      </div>
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color, minWidth: 46 }}>
        {auc.toFixed(4)}
      </span>
    </div>
  );
}

// Мини-спарклайн истории AUC
function AucSparkline({ history }) {
  if (!history?.length) return null;
  const vals = history.map(h => h.val_auc);
  const min = Math.min(...vals, 0.48);
  const max = Math.max(...vals, 0.72);
  const W = 80, H = 24;
  const x = (i) => (i / Math.max(vals.length - 1, 1)) * W;
  const y = (v) => H - ((v - min) / (max - min + 1e-9)) * H;
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = vals[vals.length - 1];
  const color = last >= THRESH_OK ? "var(--long)" : last >= THRESH_WARN ? "var(--amber)" : "var(--short)";
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(vals.length - 1)} cy={y(last)} r={2.5} fill={color} />
    </svg>
  );
}

export default function ModelMetrics() {
  const [metrics, setMetrics]     = useState([]);
  const [monitor, setMonitor]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState({});
  const [checking, setChecking]   = useState(false);
  const [saved, setSaved]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, mon] = await Promise.all([api.getModelMetrics(), api.getAucMonitor()]);
      setMetrics(m.metrics || []);
      setMonitor(mon);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh(tag) {
    setRefresh(r => ({ ...r, [tag]: true }));
    try {
      const updated = await api.refreshModelMetrics(tag);
      setMetrics(ms => ms.map(m => m.tag === tag ? { ...m, ...updated } : m));
    } catch (e) {
      alert(e.message);
    } finally {
      setRefresh(r => ({ ...r, [tag]: false }));
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      await api.checkAucNow();
      setTimeout(load, 3000); // подождать и перезагрузить
    } catch (e) {
      alert(e.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSaveMonitor() {
    try {
      await api.setAucMonitor(monitor);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e.message);
    }
  }

  const critical = metrics.filter(m => m.status === "critical").length;
  const warn     = metrics.filter(m => m.status === "warn").length;
  const unknown  = metrics.filter(m => m.status === "unknown").length;

  return (
    <div>
      {/* Сводка */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Всего моделей",  value: metrics.length,  color: "var(--text)" },
          { label: "В норме",        value: metrics.filter(m => m.status === "ok").length, color: "var(--long)" },
          { label: "Предупреждение", value: warn,            color: "var(--amber)" },
          { label: "Критично",       value: critical,        color: "var(--short)" },
          { label: "Без метрик",     value: unknown,         color: "var(--muted)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: "1 1 130px", padding: "12px 16px", borderRadius: 10,
            border: "1px solid var(--line)", background: "var(--panel)",
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Настройки монитора */}
      {monitor && (
        <div style={{
          padding: "14px 18px", borderRadius: 10, marginBottom: 20,
          border: "1px solid var(--line)", background: "var(--panel)",
        }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>
            Автомонитор AUC
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={monitor.enabled}
                onChange={e => setMonitor(m => ({ ...m, enabled: e.target.checked }))}
                style={{ accentColor: "var(--primary)", width: 15, height: 15 }} />
              Включить мониторинг
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
              <input type="checkbox" checked={monitor.auto_retrain}
                onChange={e => setMonitor(m => ({ ...m, auto_retrain: e.target.checked }))}
                style={{ accentColor: "var(--primary)", width: 15, height: 15 }} />
              Авто-retrain при критичном AUC
            </label>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Проверять каждые, ч</div>
              <input type="number" min={1} max={168} value={monitor.interval_hours}
                onChange={e => setMonitor(m => ({ ...m, interval_hours: +e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--ink-2)", color: "var(--text)", fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Порог предупреждения</div>
              <input type="number" min={0.5} max={0.99} step={0.01} value={monitor.warn_threshold}
                onChange={e => setMonitor(m => ({ ...m, warn_threshold: +e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--ink-2)", color: "var(--text)", fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                Порог авто-retrain
                <span style={{ marginLeft: 6, color: "var(--short)", fontSize: 10 }}>↓ запустит дообучение</span>
              </div>
              <input type="number" min={0.5} max={0.99} step={0.01} value={monitor.retrain_threshold}
                onChange={e => setMonitor(m => ({ ...m, retrain_threshold: +e.target.value }))}
                style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--ink-2)", color: "var(--text)", fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" style={{ width: "auto", padding: "8px 20px" }} onClick={handleSaveMonitor}>
              Сохранить настройки
            </button>
            <button className="btn ghost" style={{ width: "auto", padding: "8px 20px" }}
              onClick={handleCheckNow} disabled={checking}>
              {checking ? "Проверяю…" : "Проверить сейчас"}
            </button>
            {saved && <span style={{ color: "var(--long)", fontSize: 13 }}>✓ Сохранено</span>}
            {monitor.last_check && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                Последняя проверка: {monitor.last_check.replace("T", " ").slice(0, 16)}
              </span>
            )}
          </div>
          {monitor.last_triggered?.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--amber)" }}>
              Последний retrain: {monitor.last_triggered.map(t => `${t.tag} (AUC ${t.auc?.toFixed(4)})`).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Таблица моделей */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ opacity: 0.5, textAlign: "left" }}>
              {["Модель", "ТФ", "AUC", "Тренд", "Статус", "Обновлено", ""].map(h => (
                <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", opacity: 0.4 }}>Загрузка…</td></tr>
            ) : metrics.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", opacity: 0.4 }}>Моделей нет</td></tr>
            ) : metrics.map(m => (
              <tr key={m.tag} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "10px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>{m.symbol}</td>
                <td style={{ padding: "10px 10px", color: "var(--muted)", fontSize: 12 }}>{m.interval}</td>
                <td style={{ padding: "10px 10px", minWidth: 160 }}>
                  <AucBar auc={m.val_auc} />
                </td>
                <td style={{ padding: "10px 10px" }}>
                  <AucSparkline history={m.history} />
                </td>
                <td style={{ padding: "10px 10px" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: `${statusColor(m.status)}20`,
                    color: statusColor(m.status),
                    border: `1px solid ${statusColor(m.status)}40`,
                  }}>
                    {statusLabel(m.status)}
                  </span>
                </td>
                <td style={{ padding: "10px 10px", color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                  {m.updated ? m.updated.replace("T", " ").slice(0, 16) : "—"}
                </td>
                <td style={{ padding: "10px 10px" }}>
                  <button onClick={() => handleRefresh(m.tag)} disabled={refreshing[m.tag]}
                    title="Пересчитать AUC"
                    style={{
                      padding: "4px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                      border: "1px solid var(--line)", background: "transparent", color: "var(--muted)",
                    }}>
                    {refreshing[m.tag] ? "…" : "↻"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Пояснение порогов */}
      <div style={{ marginTop: 14, fontSize: 11, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><span style={{ color: "var(--long)", fontWeight: 600 }}>OK</span> ≥ {THRESH_OK}</span>
        <span><span style={{ color: "var(--amber)", fontWeight: 600 }}>WARN</span> {THRESH_WARN}–{THRESH_OK}</span>
        <span><span style={{ color: "var(--short)", fontWeight: 600 }}>КРИТ</span> &lt; {THRESH_WARN} → авто-retrain</span>
        <span style={{ opacity: 0.6 }}>AUC 0.5 = случайное угадывание</span>
      </div>
    </div>
  );
}
