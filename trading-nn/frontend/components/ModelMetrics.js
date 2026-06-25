"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import FeatureEditor from "@/components/FeatureEditor";

const THRESH_OK   = 0.56;
const THRESH_WARN = 0.54;

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
  const color = auc >= THRESH_OK ? "var(--long)" : auc >= THRESH_WARN ? "var(--amber)" : "var(--short)";
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

// ── Модальное окно подтверждения удаления ──────────────────────────────────
function DeleteModal({ model, onConfirm, onCancel, deleting }) {
  if (!model) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
      animation: "fadeIn .15s ease",
    }}>
      <div style={{
        background: "var(--panel)", borderRadius: 16, padding: "32px 28px",
        width: "100%", maxWidth: 420, boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        border: "1px solid var(--line)", animation: "slideUp .18s ease",
      }}>
        {/* иконка */}
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, marginBottom: 18,
        }}>
          🗑
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700 }}>
          Удалить модель?
        </h3>
        <p style={{ margin: "0 0 6px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Будут удалены все файлы модели:
        </p>

        {/* карточка модели */}
        <div style={{
          background: "var(--ink-2)", borderRadius: 10, padding: "12px 16px",
          margin: "12px 0 20px", border: "1px solid var(--line)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15,
              color: "var(--text)",
            }}>{model.symbol}</span>
            <span style={{
              padding: "1px 8px", borderRadius: 5, fontSize: 11,
              background: "var(--line)", color: "var(--muted)", fontFamily: "var(--mono)",
            }}>{model.interval}</span>
            {model.val_auc != null && (
              <span style={{
                marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 12,
                color: statusColor(model.status), fontWeight: 600,
              }}>AUC {model.val_auc.toFixed(4)}</span>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", lineHeight: 1.8 }}>
            {[".keras", ".pkl", "_config.json", "_metrics.json", "_feature_importance.json"].map(s => (
              <div key={s} style={{ fontFamily: "var(--mono)" }}>
                <span style={{ opacity: 0.45, marginRight: 4 }}>·</span>
                {model.tag}{s}
              </div>
            ))}
          </div>
        </div>

        <p style={{ margin: "0 0 24px", fontSize: 12, color: "var(--short)", fontWeight: 500 }}>
          Это действие необратимо. Восстановить модель можно только повторным обучением.
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={deleting}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 600,
              border: "1px solid var(--line)", background: "transparent",
              color: "var(--muted)", cursor: "pointer", fontFamily: "var(--body)",
            }}
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 600,
              border: "none", background: "var(--short)", color: "#fff",
              cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.7 : 1,
              fontFamily: "var(--body)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6,
            }}
          >
            {deleting ? <><span className="spinner" style={{ width: 14, height: 14, borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> Удаление…</> : "Удалить"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
    </div>
  );
}

// ── Основной компонент ────────────────────────────────────────────────────────
export default function ModelMetrics() {
  const [metrics, setMetrics]       = useState([]);
  const [monitor, setMonitor]       = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState({});
  const [checking, setChecking]     = useState(false);
  const [saved, setSaved]           = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]     = useState(false);
  const [activeTags, setActiveTags] = useState(null);
  const [savingActive, setSavingActive] = useState(false);
  const [savedActive, setSavedActive] = useState(false);
  const [featModelTag, setFeatModelTag] = useState(null);
  // загрузка модели
  const [uploading, setUploading]   = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // {ok, tag, error}
  const uploadRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, mon, act] = await Promise.all([
        api.getModelMetrics(),
        api.getAucMonitor(),
        api.getActiveModels(),
      ]);
      setMetrics(m.metrics || []);
      setMonitor(mon);
      // пустой список = все активны → null
      setActiveTags(act.active?.length ? new Set(act.active) : null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // закрытие по Escape
  useEffect(() => {
    if (!deleteTarget) return;
    const handler = (e) => { if (e.key === "Escape") setDeleteTarget(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteTarget]);

  async function handleRefresh(tag) {
    setRefreshing(r => ({ ...r, [tag]: true }));
    try {
      const updated = await api.refreshModelMetrics(tag);
      setMetrics(ms => ms.map(m => m.tag === tag ? { ...m, ...updated } : m));
    } catch (e) {
      alert(e.message);
    } finally {
      setRefreshing(r => ({ ...r, [tag]: false }));
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteModel(deleteTarget.tag);
      setMetrics(ms => ms.filter(m => m.tag !== deleteTarget.tag));
      setDeleteTarget(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      await api.checkAucNow();
      setTimeout(load, 3000);
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

  function toggleActive(tag) {
    setActiveTags(prev => {
      if (prev === null) {
        // все были активны → выключаем один (все остальные остаются)
        const next = new Set(metrics.map(m => m.tag));
        next.delete(tag);
        return next;
      }
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      // если все включены → null (все активны)
      return next.size === metrics.length ? null : next;
    });
  }

  async function handleSaveActive() {
    setSavingActive(true);
    try {
      const tags = activeTags ? [...activeTags] : [];
      await api.setActiveModels(tags);
      setSavedActive(true);
      setTimeout(() => setSavedActive(false), 2000);
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingActive(false);
    }
  }

  function isActive(tag) {
    return activeTags === null || activeTags.has(tag);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await api.uploadModel(file);
      setUploadResult({ ok: true, tag: res.tag, files: res.saved });
      await load(); // обновляем список моделей
    } catch (err) {
      setUploadResult({ ok: false, error: err.message });
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  const critical = metrics.filter(m => m.status === "critical").length;
  const warn     = metrics.filter(m => m.status === "warn").length;
  const unknown  = metrics.filter(m => m.status === "unknown").length;

  return (
    <div>
      <DeleteModal
        model={deleteTarget}
        onConfirm={handleDeleteConfirm}
        onCancel={() => !deleting && setDeleteTarget(null)}
        deleting={deleting}
      />

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

      {/* Загрузка модели с локальной машины */}
      <div style={{
        padding: "14px 18px", borderRadius: 10, marginBottom: 16,
        border: "1px solid var(--line)", background: "var(--panel)",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 3 }}>
            Загрузить модель с локальной машины
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
            ZIP-архив с файлами: <span style={{ fontFamily: "var(--mono)" }}>TAG_model.keras, TAG_scaler.pkl, TAG_config.json</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={uploadRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          <button
            className="btn"
            style={{ width: "auto", padding: "8px 20px", fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <><span className="spinner" style={{ width: 13, height: 13, borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> Загрузка…</>
              : "↑ Загрузить ZIP"}
          </button>
          {uploadResult && (
            <div style={{
              fontSize: 12, padding: "6px 12px", borderRadius: 8,
              background: uploadResult.ok ? "rgba(16,185,129,.1)" : "rgba(239,68,68,.1)",
              color: uploadResult.ok ? "var(--long)" : "var(--short)",
              border: `1px solid ${uploadResult.ok ? "rgba(16,185,129,.25)" : "rgba(239,68,68,.25)"}`,
              maxWidth: 320,
            }}>
              {uploadResult.ok
                ? <>✓ Модель <span style={{ fontFamily: "var(--mono)", fontWeight: 700 }}>{uploadResult.tag}</span> загружена ({uploadResult.files?.length} файлов)</>
                : <>✕ {uploadResult.error}</>}
            </div>
          )}
        </div>
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
        </div>
      )}

      {/* Выбор активных моделей */}
      <div style={{
        padding: "12px 18px", borderRadius: 10, marginBottom: 16,
        border: "1px solid var(--line)", background: "var(--panel)",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
            Активные модели для сигналов
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            {activeTags === null
              ? "Все модели используются для скриннера и подписок"
              : activeTags.size === 0
              ? "Ни одна модель не активна — сигналы не будут генерироваться"
              : `Активно: ${[...activeTags].join(", ")}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" style={{ width: "auto", padding: "7px 18px", fontSize: 13 }}
            onClick={handleSaveActive} disabled={savingActive}>
            {savingActive ? "Сохраняю…" : "Применить"}
          </button>
          {savedActive && <span style={{ fontSize: 13, color: "var(--long)" }}>✓ Сохранено</span>}
        </div>
      </div>

      {/* Таблица моделей */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ opacity: 0.5, textAlign: "left" }}>
              {["Активна", "Модель", "ТФ", "AUC", "Тренд", "Статус", "Обновлено", ""].map(h => (
                <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", opacity: 0.4 }}>Загрузка…</td></tr>
            ) : metrics.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", opacity: 0.4 }}>Моделей нет</td></tr>
            ) : metrics.map(m => (
              <tr key={m.tag} style={{
                borderBottom: "1px solid var(--line)",
                opacity: isActive(m.tag) ? 1 : 0.45,
                transition: "opacity .2s",
              }}>
                <td style={{ padding: "10px 10px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isActive(m.tag)}
                    onChange={() => toggleActive(m.tag)}
                    style={{ accentColor: "var(--primary)", width: 16, height: 16, cursor: "pointer" }}
                    title={isActive(m.tag) ? "Деактивировать" : "Активировать"}
                  />
                </td>
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
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setFeatModelTag(prev => prev === m.tag ? null : m.tag)}
                      title="Управление признаками"
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                        border: `1px solid ${featModelTag === m.tag ? "var(--primary)" : "var(--line)"}`,
                        background: featModelTag === m.tag ? "var(--primary)" : "transparent",
                        color: featModelTag === m.tag ? "#fff" : "var(--muted)",
                      }}
                    >
                      f(x)
                    </button>
                    <button
                      onClick={() => handleRefresh(m.tag)}
                      disabled={refreshing[m.tag]}
                      title="Пересчитать AUC"
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                        border: "1px solid var(--line)", background: "transparent", color: "var(--muted)",
                      }}
                    >
                      {refreshing[m.tag] ? "…" : "↻"}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      title="Удалить модель"
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                        border: "1px solid rgba(239,68,68,0.3)",
                        background: "rgba(239,68,68,0.07)",
                        color: "var(--short)",
                      }}
                    >
                      ✕
                    </button>
                  </div>
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
        <span><span style={{ color: "var(--short)", fontWeight: 600 }}>КРИТ</span> &lt; {THRESH_WARN}</span>
        <span style={{ opacity: 0.6 }}>AUC 0.5 = случайное угадывание</span>
      </div>

      {/* Редактор признаков выбранной модели */}
      {featModelTag && (
        <div style={{
          marginTop: 18, borderRadius: 12, border: "1px solid var(--primary)",
          background: "var(--ink-2)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid var(--line)",
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Признаки модели:</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--primary)", marginLeft: 8 }}>{featModelTag}</span>
            </div>
            <button onClick={() => setFeatModelTag(null)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 18, color: "var(--muted)", lineHeight: 1,
            }}>✕</button>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
              Изменения применяются при следующем обучении. Нажмите «Сохранить в модель» — настройки будут автоматически применяться при инференсе.
            </p>
            <FeatureEditor
              modelTag={featModelTag}
              interval={metrics.find(m => m.tag === featModelTag)?.interval || "1d"}
            />
          </div>
        </div>
      )}
    </div>
  );
}
