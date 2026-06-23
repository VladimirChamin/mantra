"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

const CLASS_LABELS = { crypto: "Крипта", stocks: "Акции", commodity: "Товары", forex: "Форекс", bonds: "Облигации" };
const DIRS = ["LONG", "SHORT", "FLAT"];
const CLASSES = ["all", "crypto", "stocks", "commodity", "forex", "bonds"];
const DIR_COLOR = { LONG: "var(--long)", SHORT: "var(--short)", FLAT: "var(--muted)" };

export default function Screener({ onScanDone }) {
  const [interval, setInterval] = useState("1d");
  const [minProb, setMinProb]   = useState(55);
  const [dirFilter, setDirFilter]     = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [sortBy, setSortBy]   = useState("prob_up");
  const [sortDir, setSortDir] = useState(-1);

  const [jobId, setJobId]       = useState(null);
  const [status, setStatus]     = useState("idle"); // idle | running | done | cancelled | error
  const [progress, setProgress] = useState(0);
  const [results, setResults]   = useState([]);
  const [errors, setErrors]     = useState([]);

  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback(async (jid) => {
    try {
      const data = await api.screenerStatus(jid);
      setProgress(data.progress ?? 0);
      setResults(data.result?.results ?? []);
      setErrors(data.result?.errors ?? []);
      if (data.status === "done") {
        setStatus("done");
        stopPolling();
        onScanDone?.();
      } else if (data.status === "cancelled" || data.status === "error") {
        setStatus(data.status);
        stopPolling();
      }
    } catch {
      // сеть временно недоступна — ждём следующего тика
    }
  }, [stopPolling, onScanDone]);

  const startScan = useCallback(async () => {
    stopPolling();
    setResults([]);
    setErrors([]);
    setProgress(0);
    setStatus("running");

    try {
      const { job_id } = await api.screenerStart({ interval, asset_class: classFilter });
      setJobId(job_id);
      pollRef.current = setInterval(() => poll(job_id), 2000);
    } catch (e) {
      setStatus("error");
    }
  }, [interval, classFilter, poll, stopPolling]);

  const cancelScan = useCallback(async () => {
    if (!jobId) return;
    try { await api.screenerCancel(jobId); } catch {}
    setStatus("cancelled");
    stopPolling();
  }, [jobId, stopPolling]);

  // Cleanup on unmount — НЕ отменяем задачу, просто перестаём поллить
  useEffect(() => () => stopPolling(), [stopPolling]);

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => -d);
    else { setSortBy(col); setSortDir(-1); }
  }

  const filtered = results
    .filter(r => dirFilter === "all" || r.direction === dirFilter)
    .filter(r => classFilter === "all" || r.asset_class === classFilter)
    .filter(r => (r.prob_up ?? 0) * 100 >= minProb)
    .sort((a, b) => sortDir * ((a[sortBy] ?? 0) - (b[sortBy] ?? 0)));

  function SortTh({ col, children }) {
    const active = sortBy === col;
    return (
      <th onClick={() => toggleSort(col)} style={{
        padding: "7px 10px", borderBottom: "1px solid var(--line)",
        fontWeight: 500, cursor: "pointer", userSelect: "none",
        color: active ? "var(--primary)" : "var(--muted)", whiteSpace: "nowrap",
      }}>
        {children} {active ? (sortDir === -1 ? "↓" : "↑") : ""}
      </th>
    );
  }

  const scanning = status === "running";
  const done     = status === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Параметры */}
      <div className="card">
        <h2>Скриннер инвестиционных идей</h2>
        <p className="sub">Массовое сканирование активов. Сканирование работает на сервере — можно переключать вкладки.</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          <div className="field">
            <label>Таймфрейм</label>
            <select value={interval} onChange={e => setInterval(e.target.value)} disabled={scanning}>
              <option value="1d">1D — дневной</option>
              <option value="4h">4H — четырёхчасовой</option>
            </select>
          </div>
          <div className="field">
            <label>Мин. вероятность Long (%)</label>
            <input type="number" className="num" min={0} max={100} value={minProb}
              onChange={e => setMinProb(+e.target.value)} />
          </div>
          <div className="field">
            <label>Направление</label>
            <select value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
              <option value="all">Все</option>
              {DIRS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Класс актива</label>
            <select value={classFilter} onChange={e => setClassFilter(e.target.value)} disabled={scanning}>
              {CLASSES.map(c => (
                <option key={c} value={c}>{c === "all" ? "Все" : CLASS_LABELS[c] || c}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn" onClick={startScan} disabled={scanning} style={{ maxWidth: 240 }}>
            {scanning ? `Сканирование… ${progress}%` : "Запустить скриннер"}
          </button>
          {scanning && (
            <button onClick={cancelScan} style={{
              background: "none", border: "1px solid var(--short)", color: "var(--short)",
              borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 12,
            }}>
              Остановить
            </button>
          )}
          {status === "cancelled" && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Остановлено</span>
          )}
        </div>

        {(scanning || (done && results.length > 0)) && (
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 4, background: "var(--line-soft)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--primary)", width: `${progress}%`, transition: "width .4s" }} />
            </div>
            {scanning && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Найдено сигналов: {results.length} · Обработано: {progress}%
              </div>
            )}
          </div>
        )}

        {errors.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--short)" }}>
              Пропущено инструментов: {errors.length}
            </summary>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {errors.map(({ symbol, msg }) => (
                <div key={symbol} style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted-2)" }}>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{symbol}</span>
                  {" — "}{msg}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Результаты */}
      {(results.length > 0 || done) && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0 }}>Инвестиционные идеи</h2>
              <p className="sub" style={{ margin: "4px 0 0" }}>
                Найдено: {filtered.length} из {results.length} активов
                {scanning && <span style={{ color: "var(--primary)", marginLeft: 8 }}>· обновляется…</span>}
              </p>
            </div>
            {done && (
              <span style={{ fontSize: 12, color: "var(--long)", background: "rgba(45,212,167,.1)", border: "1px solid rgba(45,212,167,.2)", borderRadius: 6, padding: "4px 10px" }}>
                Готово
              </span>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              {results.length === 0
                ? "Нет данных. Запустите скриннер."
                : "Нет идей, соответствующих фильтрам. Попробуйте снизить мин. вероятность."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <SortTh col="symbol">Инструмент</SortTh>
                    <SortTh col="asset_class">Класс</SortTh>
                    <SortTh col="direction">Направление</SortTh>
                    <SortTh col="prob_up">P(up)</SortTh>
                    <SortTh col="entry">Вход</SortTh>
                    <SortTh col="stop_loss">SL</SortTh>
                    <SortTh col="take_profit">TP</SortTh>
                    <SortTh col="risk_reward">R/R</SortTh>
                    <SortTh col="confidence">Уверенность</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={`${r.symbol}-${i}`}
                      style={{ borderBottom: "1px solid var(--line)", transition: "background .1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{r.symbol}</span>
                        {r.label && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>{r.label}</span>}
                      </td>
                      <td style={{ padding: "9px 10px", color: "var(--muted)", fontSize: 12 }}>
                        {CLASS_LABELS[r.asset_class] || r.asset_class}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{
                          fontFamily: "var(--mono)", fontWeight: 700, fontSize: 12,
                          padding: "3px 8px", borderRadius: 5,
                          background: r.direction === "LONG" ? "var(--long-dim)" : r.direction === "SHORT" ? "var(--short-dim)" : "var(--line)",
                          color: DIR_COLOR[r.direction] || "var(--muted)",
                        }}>{r.direction}</span>
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", fontWeight: 600 }}>
                        <span style={{ color: (r.prob_up ?? 0) >= 0.6 ? "var(--long)" : (r.prob_up ?? 0) >= 0.5 ? "var(--amber)" : "var(--short)" }}>
                          {r.prob_up != null ? `${(r.prob_up * 100).toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>
                        {r.entry != null ? r.entry.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--short)" }}>
                        {r.stop_loss != null ? r.stop_loss.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "var(--mono)", color: "var(--long)" }}>
                        {r.take_profit != null ? r.take_profit.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px", fontFamily: "var(--mono)" }}>
                        {r.risk_reward != null ? r.risk_reward.toFixed(2) : "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        {r.confidence != null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 48, height: 4, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", background: "var(--primary)", width: `${(r.confidence * 100).toFixed(0)}%` }} />
                            </div>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>{(r.confidence * 100).toFixed(0)}%</span>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
