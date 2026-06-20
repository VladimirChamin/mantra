"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const DEFAULT_SCHEDULES = [
  { interval: "1d",  label: "Дневной (1D)",          freq: "weekly",   time: "02:00", day_of_week: 6 },
  { interval: "4h",  label: "Четырёхчасовой (4H)",   freq: "every3d",  time: "03:00", day_of_week: 0 },
  { interval: "1h",  label: "Часовой (1H)",           freq: "twice_daily", time: "01:00", time2: "13:00" },
];

const FREQ_LABELS = {
  weekly:      "Раз в неделю",
  every3d:     "Раз в 3 дня",
  twice_daily: "2 раза в день",
  daily:       "Ежедневно",
  manual:      "Вручную",
};

const DAYS = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];

export default function RetrainingPanel() {
  const [schedules, setSchedules] = useState(DEFAULT_SCHEDULES);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [triggering, setTriggering] = useState({});
  const [triggerMsg, setTriggerMsg] = useState({});

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const data = await api.getRetrainHistory();
      setHistory(data.history || []);
    } catch {
      setHistory([]);
    }
  }

  async function saveSchedules() {
    setSaving(true); setSaveMsg(""); setSaveErr("");
    try {
      await api.saveRetrainSchedules(schedules);
      setSaveMsg("Расписание сохранено");
    } catch (e) {
      setSaveErr(e.message);
    }
    setSaving(false);
  }

  async function triggerNow(interval) {
    setTriggering(t => ({ ...t, [interval]: true }));
    setTriggerMsg(m => ({ ...m, [interval]: "" }));
    try {
      const r = await api.triggerRetrain(interval);
      setTriggerMsg(m => ({ ...m, [interval]: `Задача запущена (job: ${r.job_id})` }));
      await loadHistory();
    } catch (e) {
      setTriggerMsg(m => ({ ...m, [interval]: `Ошибка: ${e.message}` }));
    }
    setTriggering(t => ({ ...t, [interval]: false }));
  }

  function updateSchedule(idx, field, value) {
    setSchedules(s => s.map((sc, i) => i === idx ? { ...sc, [field]: value } : sc));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Заголовок */}
      <div className="card">
        <h2>Автопереобучение моделей</h2>
        <p className="sub">
          Настройте расписание переобучения для каждого таймфрейма.
          Задача запускает то же обучение, что и вкладка «Обучение», но автоматически по расписанию.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
          {schedules.map((sc, idx) => (
            <div key={sc.interval} style={{
              background: "var(--ink)", border: "1px solid var(--line)",
              borderRadius: 12, padding: "16px 18px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15, color: "var(--primary)" }}>
                    {sc.interval.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--muted)", marginLeft: 10 }}>{sc.label}</span>
                </div>
                <button
                  className="btn ghost"
                  onClick={() => triggerNow(sc.interval)}
                  disabled={triggering[sc.interval]}
                  style={{ width: "auto", padding: "7px 14px", fontSize: 12 }}>
                  {triggering[sc.interval] ? "Запуск…" : "▶ Запустить сейчас"}
                </button>
              </div>

              {triggerMsg[sc.interval] && (
                <div style={{
                  fontSize: 12, marginBottom: 12,
                  color: triggerMsg[sc.interval].startsWith("Ошибка") ? "var(--short)" : "var(--long)",
                }}>
                  {triggerMsg[sc.interval]}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div className="field">
                  <label>Частота</label>
                  <select value={sc.freq} onChange={e => updateSchedule(idx, "freq", e.target.value)}>
                    {Object.entries(FREQ_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>

                {(sc.freq === "weekly") && (
                  <div className="field">
                    <label>День недели</label>
                    <select value={sc.day_of_week ?? 6} onChange={e => updateSchedule(idx, "day_of_week", +e.target.value)}>
                      {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}

                {sc.freq !== "twice_daily" ? (
                  <div className="field">
                    <label>Время (UTC)</label>
                    <input type="time" value={sc.time}
                      onChange={e => updateSchedule(idx, "time", e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label>Время 1 (UTC)</label>
                      <input type="time" value={sc.time}
                        onChange={e => updateSchedule(idx, "time", e.target.value)} />
                    </div>
                    <div className="field">
                      <label>Время 2 (UTC)</label>
                      <input type="time" value={sc.time2 || "13:00"}
                        onChange={e => updateSchedule(idx, "time2", e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18 }}>
          <button className="btn" onClick={saveSchedules} disabled={saving} style={{ maxWidth: 200 }}>
            {saving ? "Сохранение…" : "Сохранить расписание"}
          </button>
          {saveMsg && <span style={{ fontSize: 13, color: "var(--long)" }}>{saveMsg}</span>}
          {saveErr && <span style={{ fontSize: 13, color: "var(--short)" }}>{saveErr}</span>}
        </div>
      </div>

      {/* История переобучений */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>История переобучений</h2>
            <p className="sub" style={{ margin: "4px 0 0" }}>Последние запуски — ручные и по расписанию</p>
          </div>
          <button className="btn ghost" onClick={loadHistory}
            style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}>
            Обновить
          </button>
        </div>

        {history.length === 0 ? (
          <div className="empty">Переобучений ещё не было</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ opacity: 0.6, textAlign: "left" }}>
                  {["Дата", "Таймфрейм", "Инструменты", "Статус", "Запущено"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>
                      {h.created_at ? new Date(h.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: "var(--primary)" }}>{h.interval || "—"}</td>
                    <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 12 }}>
                      {h.symbols || h.asset_class || "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5,
                        background: h.status === "done" ? "var(--long-dim)" : h.status === "error" ? "var(--short-dim)" : "var(--line)",
                        color: h.status === "done" ? "var(--long)" : h.status === "error" ? "var(--short)" : "var(--muted)",
                      }}>
                        {h.status === "done" ? "Готово" : h.status === "error" ? "Ошибка" : h.status || "В процессе"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 12 }}>
                      {h.triggered_by === "schedule" ? "Расписание" : "Вручную"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
