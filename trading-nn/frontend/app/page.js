"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { getUser, logout } from "@/lib/auth";
import SignalTicket from "@/components/SignalTicket";
import ForecastChart from "@/components/ForecastChart";
import MetricGrid from "@/components/MetricGrid";
import EquityChart from "@/components/EquityChart";
import JobLog from "@/components/JobLog";
import AIAnalysis from "@/components/AIAnalysis";
import HistoryPanel from "@/components/HistoryPanel";
import AdminPanel from "@/components/AdminPanel";
import Screener from "@/components/Screener";
import Subscriptions from "@/components/Subscriptions";
import ModelMetrics from "@/components/ModelMetrics";
import FeatureEditor from "@/components/FeatureEditor";
import SymbolInput from "@/components/SymbolInput";
import WalkForwardChart from "@/components/WalkForwardChart";
import Notes from "@/components/Notes";

const DEFAULT_INTERVALS = ["1d", "4h"];

// ── Вердикт walk-forward + кнопка активации ───────────────────────────────────
function WfVerdictPanel({ result, symbol, interval }) {
  const v = result?.verdict;
  const ov = result?.overall || {};
  const [minPf, setMinPf]       = useState(1.3);
  const [minRf, setMinRf]       = useState(2.0);
  const [minWr, setMinWr]       = useState(45);   // в процентах
  const [minTrades, setMinTrades] = useState(10);
  const [status, setStatus]     = useState(null); // {ok, activated, reason, forced}
  const [loading, setLoading]   = useState(false);

  const pf = ov.profit_factor ?? 0;
  const rf = ov.recovery_factor ?? 0;
  const wr = (ov.win_rate ?? 0) * 100;
  const n  = ov.n_trades ?? 0;

  const passes = {
    pf: pf >= minPf, rf: rf >= minRf, wr: wr >= minWr, n: n >= minTrades,
  };
  const allPass = passes.pf && passes.rf && passes.wr && passes.n;

  async function activate(force = false) {
    setLoading(true); setStatus(null);
    try {
      const r = await api.activateByWf({
        symbol, interval,
        min_pf: minPf, min_rf: minRf, min_wr: minWr / 100, min_trades: minTrades,
        force,
      });
      setStatus(r);
    } catch (e) { setStatus({ error: e.message }); }
    setLoading(false);
  }

  const thRow = (label, val, threshold, pass, fmt = v => v.toFixed(2)) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ width: 130, fontSize: 12, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, width: 70,
                     color: pass ? "var(--long)" : "var(--short)" }}>
        {fmt(val)}
      </span>
      <span style={{ fontSize: 11, color: "var(--muted-2)" }}>порог ≥</span>
      <input type="number" step="0.1" value={threshold.val}
        onChange={e => threshold.set(parseFloat(e.target.value) || 0)}
        style={{ width: 60, fontFamily: "var(--mono)", fontSize: 12, padding: "2px 6px",
                 borderRadius: 6, border: "1px solid var(--line)", background: "var(--ink-2)",
                 color: "var(--text)" }} />
      <span style={{ fontSize: 14, marginLeft: 4 }}>{pass ? "✓" : "✗"}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 22, borderRadius: 12, border: `2px solid ${allPass ? "var(--long)" : "var(--short)"}`,
                  background: allPass ? "rgba(16,185,129,.06)" : "rgba(239,68,68,.06)", padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: allPass ? "var(--long)" : "var(--short)" }}>
          {allPass ? "✓ Модель ПРОШЛА фильтр" : "✗ Модель НЕ ПРОШЛА фильтр"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          Настройте пороги и проверьте — подходит ли модель для торговли
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        {thRow("Profit Factor", pf, { val: minPf, set: setMinPf }, passes.pf)}
        {thRow("Recovery Factor", rf, { val: minRf, set: setMinRf }, passes.rf)}
        {thRow("Win Rate", wr, { val: minWr, set: setMinWr }, passes.wr, v => v.toFixed(0) + "%")}
        {thRow("Мин. сделок", n, { val: minTrades, set: setMinTrades }, passes.n, v => String(Math.round(v)))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => activate(false)}
          disabled={loading || !allPass}
          style={{
            padding: "8px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700,
            cursor: allPass ? "pointer" : "not-allowed",
            border: "none", background: allPass ? "var(--long)" : "var(--muted-2)", color: "#fff",
          }}
        >
          {loading ? "…" : "Активировать модель"}
        </button>
        {!allPass && (
          <button
            onClick={() => activate(true)}
            disabled={loading}
            style={{
              padding: "8px 18px", borderRadius: 9, fontSize: 12, fontWeight: 600,
              cursor: "pointer", border: "1px solid var(--line)",
              background: "transparent", color: "var(--muted)",
            }}
          >
            Активировать принудительно
          </button>
        )}
      </div>

      {status && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 8, fontSize: 13,
          background: status.error ? "rgba(239,68,68,.1)" : status.activated ? "rgba(16,185,129,.1)" : "rgba(245,158,11,.1)",
          color: status.error ? "var(--short)" : status.activated ? "var(--long)" : "var(--amber, #f59e0b)",
          border: `1px solid ${status.error ? "var(--short)" : status.activated ? "var(--long)" : "var(--amber, #f59e0b)"}`,
        }}>
          {status.error
            ? `Ошибка: ${status.error}`
            : status.activated
              ? `✓ Модель активирована${status.forced ? " (принудительно)" : ""}. Тег: ${status.tag}`
              : `✗ ${status.reason}`}
        </div>
      )}
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function SymbolTags({ value, onChange }) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  const symbols = value
    ? value.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  function commit(raw) {
    const newTags = raw.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!newTags.length) return;
    const merged = [...new Set([...symbols, ...newTags])];
    onChange(merged.join(" "));
    setInput("");
  }

  function remove(sym) {
    onChange(symbols.filter(s => s !== sym).join(" "));
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commit(input);
    } else if (e.key === "Backspace" && input === "" && symbols.length) {
      remove(symbols[symbols.length - 1]);
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        minHeight: 42, padding: "6px 10px",
        border: "1px solid var(--line)", borderRadius: 10,
        background: "var(--ink-2)", cursor: "text",
        transition: "border-color .15s",
      }}
      onFocus={() => {}}
    >
      {symbols.map(sym => (
        <span key={sym} style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 10px", borderRadius: 6,
          background: "color-mix(in srgb, var(--primary) 15%, transparent)",
          border: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)",
          color: "var(--primary)", fontFamily: "var(--mono)",
          fontSize: 12, fontWeight: 600, lineHeight: 1,
        }}>
          {sym}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); remove(sym); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--primary)", opacity: 0.6, padding: 0,
              fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
            onMouseLeave={e => e.currentTarget.style.opacity = "0.6"}
          >×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value.toUpperCase())}
        onKeyDown={onKeyDown}
        onBlur={() => input && commit(input)}
        placeholder={symbols.length ? "" : "BTCUSDT SBER EURUSD…"}
        style={{
          flex: "1 1 100px", minWidth: 80, border: "none", outline: "none",
          background: "transparent", color: "var(--text)",
          fontFamily: "var(--mono)", fontSize: 13,
          padding: "2px 0",
        }}
      />
    </div>
  );
}

const ORDER_STATUS_META = {
  pending:   { label: "⏳ Ожидает активации", color: "var(--muted)",  bg: "var(--ink-2)" },
  active:    { label: "● Позиция открыта",    color: "var(--primary)", bg: "rgba(59,111,240,.1)" },
  cancelled: { label: "✕ Ордер отменён",      color: "var(--muted)",  bg: "var(--ink-2)" },
  sl_hit:    { label: "✗ Стоп-лосс",          color: "var(--short)",  bg: "var(--short-dim)" },
  tp_hit:    { label: "✓ Тейк-профит",        color: "var(--long)",   bg: "var(--long-dim)" },
  expired:   { label: "⌛ Горизонт истёк",    color: "var(--muted)",  bg: "var(--ink-2)" },
  flat:      { label: "— Нет сигнала",        color: "var(--muted)",  bg: "var(--ink-2)" },
};

function OrderResultBadge({ r }) {
  if (!r) return null;
  const meta = ORDER_STATUS_META[r.status] || ORDER_STATUS_META.flat;
  const pnlColor = r.pnl_pct == null ? "var(--muted)" : r.pnl_pct >= 0 ? "var(--long)" : "var(--short)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: meta.bg, color: meta.color }}>
        {meta.label}
      </span>
      {r.order_activated && r.activated_price != null && (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          вход <strong style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>{r.activated_price}</strong>
        </span>
      )}
      {r.pnl_pts != null && (
        <span style={{ fontSize: 11, fontWeight: 600, color: pnlColor, fontFamily: "var(--mono)" }}>
          {r.pnl_pts > 0 ? "+" : ""}{r.pnl_pts} ({r.pnl_pct > 0 ? "+" : ""}{r.pnl_pct}%)
        </span>
      )}
    </span>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState(null);
  const [health, setHealth] = useState(null);
  const [online, setOnline] = useState(false);
  const [meta, setMeta] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [signals, setSignals] = useState([]);
  const [aiQuota, setAiQuota] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = currentUser?.role === "admin";


  // обучение по классам активов
  const [assetClasses, setAssetClasses] = useState(null);
  const [activeClass, setActiveClass] = useState("stocks");
  const [classTrainParams, setClassTrainParams] = useState({
    stocks:    { interval: "1d", epochs: 40, period: "6y", entry_offset_mult: 0, horizon: 10, lookback: 32, warm_start: false, direction_filter: "both", excluded_features: [], symbols: "SBER GAZP LKOH GMKN ROSN NVTK TATN MGNT YDEX MOEX" },
    crypto:    { interval: "1d", epochs: 40, period: "6y", entry_offset_mult: 0, horizon: 10, lookback: 32, warm_start: false, direction_filter: "both", excluded_features: [], symbols: "BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT" },
    bonds:     { interval: "1d", epochs: 40, period: "6y", entry_offset_mult: 0, horizon: 10, lookback: 32, warm_start: false, direction_filter: "both", excluded_features: [], symbols: "SU26238RMFS4 SU26240RMFS0 SU26233RMFS5" },
    forex:     { interval: "1d", epochs: 40, period: "6y", entry_offset_mult: 0, horizon: 10, lookback: 32, warm_start: false, direction_filter: "both", excluded_features: [], symbols: "EURUSD GBPUSD USDJPY USDRUB EURRUB" },
    commodity: { interval: "1d", epochs: 40, period: "6y", entry_offset_mult: 0, horizon: 10, lookback: 32, warm_start: false, direction_filter: "both", excluded_features: [], symbols: "XAUUSD XAGUSD CL NG BRENT ZC ZW ZS" },
  });

  const [train, setTrain] = useState({
    symbol: "", interval: "1d", period: "6y",
    epochs: 40, horizon: 6, lookback: 50, warm_start: false,
    entry_offset_mult: 0,
  });
  const [bt, setBt] = useState({
    symbol: "", interval: "1d", period: "6y",
    train_bars: 700, test_bars: 120, epochs: 15, horizon: 6, lookback: 50,
    anchored: false, commission: 0.0005, slippage: 0.0005,
  });
  const [pred, setPred] = useState({ symbol: "", interval: "1d" });
  const [signal, setSignal] = useState(null);
  const [fc, setFc] = useState(null);
  const [predIntervals, setPredIntervals] = useState(null); // null = не загружены (показываем все)

  const intervals = meta?.intervals || DEFAULT_INTERVALS;
  const instruments = meta?.instruments || [];

  // При смене символа в форме прогноза — загружаем доступные таймфреймы
  function handlePredSymbolChange(sym) {
    setPred(p => ({ ...p, symbol: sym }));
    setPredIntervals(null);
    if (!sym) return;
    api.getAvailableIntervals(sym).then(d => {
      const avail = d.intervals || [];
      setPredIntervals(avail.length ? avail : null);
      // если текущий таймфрейм недоступен — берём первый доступный
      if (avail.length && !avail.includes(pred.interval)) {
        setPred(p => ({ ...p, interval: avail[0] }));
      }
    }).catch(() => setPredIntervals(null));
  }

  // применить пресет таймфрейма к форме обучения
  function setTrainInterval(iv) {
    const p = meta?.presets?.[iv];
    setTrain((s) => ({
      ...s, interval: iv,
      ...(p ? { horizon: p.horizon, lookback: p.lookback, period: p.period } : {}),
    }));
  }
  function setBtInterval(iv) {
    const p = meta?.presets?.[iv];
    const w = meta?.backtest_presets?.[iv];
    setBt((s) => ({
      ...s, interval: iv,
      ...(p ? { horizon: p.horizon, lookback: p.lookback, period: p.period } : {}),
      ...(w ? { train_bars: w.train_bars, test_bars: w.test_bars } : {}),
    }));
  }

  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const poll = useRef(null);
  const [historyFc, setHistoryFc] = useState(null); // выбранный прогноз из истории

  // состояние backend
  async function refreshHealth() {
    try {
      const h = await api.health();
      setHealth(h);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }
  useEffect(() => {
    const u = getUser();
    setCurrentUser(u);
    setTab("signal");
    setUserLoaded(true);
    refreshHealth();
    api.meta().then(setMeta).catch(() => {});
    api.assetClasses().then(setAssetClasses).catch(() => {});
    api.mySignals().then(d => setSignals(d.signals || [])).catch(() => {});
    api.aiQuota().then(setAiQuota).catch(() => {});
    const t = setInterval(refreshHealth, 10000);
    return () => clearInterval(t);
  }, []);

  // опрос активной задачи
  function watch(jobId) {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const j = await api.job(jobId);
        setJob(j);
        if (j.status === "done" || j.status === "error" || j.status === "cancelled") {
          clearInterval(poll.current);
          setBusy(false);
          refreshHealth();
        }
      } catch (e) {
        clearInterval(poll.current);
        setBusy(false);
        setErr(e.message);
      }
    }, 1500);
  }
  useEffect(() => () => poll.current && clearInterval(poll.current), []);

  async function stopJob() {
    if (!job?.id) return;
    try { await api.cancelJob(job.id); } catch (e) { setErr(e.message); }
  }

  async function startTrain() {
    setErr(""); setBusy(true); setJob(null);
    try {
      const r = await api.train({
        ...train,
        epochs: +train.epochs, horizon: +train.horizon, lookback: +train.lookback,
        entry_offset_mult: +train.entry_offset_mult,
      });
      watch(r.job_id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function startBacktest() {
    setErr(""); setBusy(true); setJob(null);
    try {
      const r = await api.backtest({
        ...bt,
        train_bars: +bt.train_bars, test_bars: +bt.test_bars, epochs: +bt.epochs,
        horizon: +bt.horizon, lookback: +bt.lookback,
        commission: +bt.commission, slippage: +bt.slippage,
      });
      watch(r.job_id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  function setClassInterval(iv) {
    const p = meta?.presets?.[iv];
    setClassTrainParams(prev => ({
      ...prev,
      [activeClass]: {
        ...prev[activeClass],
        interval: iv,
        ...(p ? { horizon: p.horizon, lookback: p.lookback, period: p.period } : {}),
      },
    }));
  }

  async function startClassTrain() {
    setErr(""); setBusy(true); setJob(null);
    const p = classTrainParams[activeClass] || {};
    try {
      const syms = (p.symbols || "").trim().split(/[\s,]+/).filter(Boolean);
      const r = await api.trainUniversal({
        symbols: syms,
        asset_class: activeClass,
        interval: p.interval || "1d",
        epochs: +(p.epochs || 40),
        period: p.period || "6y",
        entry_offset_mult: +(p.entry_offset_mult ?? 0),
        horizon: +(p.horizon || 10),
        lookback: +(p.lookback || 32),
        direction_filter: p.direction_filter || "both",
        excluded_features: p.excluded_features || [],
      });
      watch(r.job_id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const [currentSignalId, setCurrentSignalId] = useState(null);

  async function getSignal() {
    setErr(""); setBusy(true); setSignal(null); setFc(null); setHistoryFc(null); setCurrentSignalId(null);
    try {
      const f = await api.forecast({ ...pred, steps: 10, history: 50 });
      setFc(f);
      setSignal(f.signal);
      // подгружаем список сигналов и берём id только что сохранённого (первый в списке)
      api.mySignals().then(d => {
        const list = d.signals || [];
        setSignals(list);
        if (list.length > 0) setCurrentSignalId(list[0].id);
      }).catch(() => {});
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function deleteSignal(id) {
    try {
      await api.deleteSignal(id);
      setSignals(s => s.filter(x => x.id !== id));
      if (historyFc?.signal_id === id) setHistoryFc(null);
    } catch (e) { setErr(e.message); }
  }

  const [actualsLoading, setActualsLoading] = useState(false);

  async function viewSignalChart(s) {
    if (!s.forecast_json) return;
    try {
      const data = JSON.parse(s.forecast_json);
      const explanation = s.explanation_json ? JSON.parse(s.explanation_json) : null;
      const signal = data.signal || null;
      const signalWithExpl = signal
        ? { ...signal, explanation: explanation || signal.explanation }
        : explanation ? { explanation } : null;

      const history = data.history || [];
      const fromTime = history.length > 0 ? history[history.length - 1].time : s.signal_time || s.created_at;
      const steps = (data.forecast || []).length || 10;

      // если уже есть сохранённые актуалы — показываем их сразу
      const savedActuals = s.actuals_json ? JSON.parse(s.actuals_json) : [];

      setHistoryFc({
        ...data,
        signal: signalWithExpl,
        signal_id: s.id,
        _signalId: s.id,
        symbol: s.symbol,
        interval: s.interval,
        _fromTime: fromTime,
        _steps: steps,
        actuals: savedActuals,
      });

      // автоматически подкачиваем и сохраняем актуальные котировки
      setActualsLoading(true);
      try {
        const res = await api.saveSignalActuals(s.id);
        setHistoryFc(prev => prev ? { ...prev, actuals: res.bars || [], order_result: res.order_result || null } : prev);
        setSignals(prev => prev.map(x => x.id === s.id ? { ...x, actuals_json: JSON.stringify(res.bars || []) } : x));
      } catch (e) {
        console.error("saveSignalActuals error", e);
      }
      setActualsLoading(false);
    } catch {}
  }

  async function loadActuals() {
    if (!historyFc) return;
    setActualsLoading(true);
    try {
      const res = await api.saveSignalActuals(historyFc._signalId);
      setHistoryFc(prev => prev ? { ...prev, actuals: res.bars || [], order_result: res.order_result || null } : prev);
      setSignals(prev => prev.map(x => x.id === historyFc._signalId ? { ...x, actuals_json: JSON.stringify(res.bars || []) } : x));
    } catch (e) {
      console.error("loadActuals error", e);
    }
    setActualsLoading(false);
  }

  const btResult = job && job.kind === "backtest" && job.status === "done" ? job.result : null;
  const trainSignal = job && job.kind === "train" && job.status === "done" ? job.result?.signal : null;
  const fiResult = job && job.kind === "feature_importance" && job.status === "done" ? job.result : null;

  // Feature importance
  const [fi, setFi] = useState(null);
  const [fiLoading, setFiLoading] = useState(false);
  const [featEditorOpen, setFeatEditorOpen] = useState(false);
  const [fiOptApplied, setFiOptApplied] = useState(false); // флаг анимации кнопки
  // при оптимизации — передаём конкретный список excluded в FeatureEditor через отдельный проп
  // null = не применять (FeatureEditor сам управляет), массив = применить снаружи
  const [featExcludedOverride, setFeatExcludedOverride] = useState(null);

  async function startFeatureImportance() {
    setErr(""); setBusy(true); setJob(null); setFi(null);
    const p = classTrainParams[activeClass] || {};
    const sym = (p.symbols || "").trim().split(/[\s,]+/).filter(Boolean)[0] || activeClass.toUpperCase();
    try {
      const r = await api.runFeatureImportance({ symbol: sym, interval: p.interval || "1d", n_repeats: 3 });
      watch(r.job_id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function loadFeatureImportance() {
    setFiLoading(true);
    const p = classTrainParams[activeClass] || {};
    const sym = (p.symbols || "").trim().split(/[\s,]+/).filter(Boolean)[0] || activeClass.toUpperCase();
    try {
      const r = await api.getFeatureImportance(sym, p.interval || "1d");
      setFi(r);
    } catch (e) { setErr(e.message); }
    setFiLoading(false);
  }

  function applyFiOptimization(threshold = 0.005) {
    const data = fi || fiResult;
    if (!data) return;
    const features = data.features || data.top10 || [];
    // признаки с importance <= threshold — исключаем
    const excluded = features
      .filter(f => f.importance <= threshold)
      .map(f => f.feature);
    // обновляем classTrainParams для передачи в запрос обучения
    setClassTrainParams(p => ({
      ...p, [activeClass]: { ...p[activeClass], excluded_features: excluded }
    }));
    // передаём override в FeatureEditor (сбрасывается после применения через onOverrideApplied)
    setFeatExcludedOverride(excluded);
    setFeatEditorOpen(true);
    setFiOptApplied(true);
    setTimeout(() => setFiOptApplied(false), 2000);
  }

  if (!userLoaded) return (
    <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <span className="spinner" style={{ width: 20, height: 20 }} />
    </div>
  );

  // Основные табы (видны всем пользователям)
  const mainTabs = [
    ["signal", "Сигнал"],
    ["screener", "Скриннер"],
    ["subscriptions", "Подписки"],
    ["notes", "Заметки"],
    ...(isAdmin ? [["neurolab", "NeuroLab"]] : []),
    ...(isAdmin ? [["admin", "Админка"]] : []),
  ];

  // Подменю NeuroLab (только для админа)
  const neurolabSubTabs = [
    ["classes", "Обучение"],
    ["backtest", "Walk-forward"],
    ["metrics", "Нейросети"],
  ];

  const isNeurolabSub = neurolabSubTabs.some(([k]) => k === tab);

  const NAV_ICONS = {
    signal:        "◈",
    screener:      "⊞",
    subscriptions: "◉",
    notes:         "✎",
    neurolab:      "⬡",
    admin:         "⚙",
    classes:       "▣",
    backtest:      "▷",
    metrics:       "▦",
    profile:       "○",
  };

  const allNavItems = [
    ...mainTabs,
    ...(isAdmin && (tab === "neurolab" || isNeurolabSub) ? neurolabSubTabs : []),
    ["profile", "Профиль"],
  ];

  return (
    <div className="app-layout">

      {/* ── Левый сайдбар ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">M</span>
          <span className="sidebar-title">MANTRA</span>
          <span className={`dot ${online ? "live" : "down"}`} style={{ marginLeft: 4 }} />
        </div>

        <nav className="sidebar-nav">
          {mainTabs.map(([k, label]) => {
            const isActive = tab === k || (k === "neurolab" && isNeurolabSub);
            return (
              <React.Fragment key={k}>
                <button
                  className={`nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setTab(k === "neurolab" ? "classes" : k)}
                >
                  <span className="nav-icon">{NAV_ICONS[k] || "◆"}</span>
                  <span className="nav-label">{label}</span>
                  {isActive && <span className="nav-pip" />}
                </button>

                {/* подменю NeuroLab */}
                {k === "neurolab" && isAdmin && (tab === "neurolab" || isNeurolabSub) && (
                  <div className="nav-sub">
                    {neurolabSubTabs.map(([sk, slabel]) => (
                      <button key={sk}
                        className={`nav-sub-item ${tab === sk ? "active" : ""}`}
                        onClick={() => setTab(sk)}
                      >
                        <span className="nav-icon">{NAV_ICONS[sk] || "·"}</span>
                        <span className="nav-label">{slabel}</span>
                      </button>
                    ))}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {currentUser && (
            <>
              <button onClick={() => setTab("profile")}
                className={`nav-item nav-profile ${tab === "profile" ? "active" : ""}`}>
                <span className="user-avatar-sm">{(currentUser.name || currentUser.email || "?")[0].toUpperCase()}</span>
                <div className="nav-profile-info">
                  <span className="nav-label">{currentUser.name || currentUser.email}</span>
                  {isAdmin && <span className="role-badge" style={{ fontSize: 9, padding: "1px 5px" }}>admin</span>}
                </div>
              </button>
              <button onClick={logout} className="sidebar-logout">Выйти</button>
            </>
          )}
        </div>
      </aside>

      {/* ── Мобильный хедер ── */}
      <header className="mobile-header">
        <div className="brand">
          <h1>MANTRA</h1>
          <span className={`dot ${online ? "live" : "down"}`} style={{ marginLeft: 6 }} />
        </div>
        <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Меню">
          <span /><span /><span />
        </button>
      </header>

      {/* ── Мобильный дровер ── */}
      {menuOpen && (
        <div className="mobile-menu">
          <div className="mobile-menu-overlay" onClick={() => setMenuOpen(false)} />
          <div className="mobile-menu-drawer">
            <div className="mobile-menu-header">
              <span style={{ fontWeight: 700, fontSize: 16 }}>MANTRA</span>
              <button onClick={() => setMenuOpen(false)} className="close-btn">✕</button>
            </div>
            {currentUser && (
              <div className="mobile-user">
                <div style={{ fontWeight: 600, fontSize: 14 }}>{currentUser.name || currentUser.email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{isAdmin ? "Администратор" : "Пользователь"}</div>
              </div>
            )}
            {allNavItems.map(([k, label]) => (
              <button key={k}
                className={`mobile-tab ${tab === k ? "active" : ""}`}
                onClick={() => { setTab(k === "neurolab" ? "classes" : k); setMenuOpen(false); }}
              >
                {label}
              </button>
            ))}
            <button onClick={() => { logout(); setMenuOpen(false); }} className="mobile-logout">Выйти</button>
          </div>
        </div>
      )}

      {/* ── Основной контент ── */}
      <main className="main-content">



      {tab === "train" && isAdmin && (
        <div className="grid">
          <div className="card">
            <h2>Параметры обучения</h2>
            <p className="sub">Модель обучается на истории и сохраняется на сервере.</p>
            <div className="row2">
              <Field label="Инструмент">
                <SymbolInput value={train.symbol} instruments={instruments} onChange={v => setTrain({ ...train, symbol: v })} />
              </Field>
              <Field label="Таймфрейм">
                <select value={train.interval} onChange={(e) => setTrainInterval(e.target.value)}>
                  {intervals.map((i) => <option key={i}>{i}</option>)}
                </select>
              </Field>
            </div>
            <div className="row3">
              <Field label="История"><input className="num" value={train.period} onChange={(e) => setTrain({ ...train, period: e.target.value })} /></Field>
              <Field label="Эпохи"><input className="num" value={train.epochs} onChange={(e) => setTrain({ ...train, epochs: e.target.value })} /></Field>
              <Field label="Горизонт"><input className="num" value={train.horizon} onChange={(e) => setTrain({ ...train, horizon: e.target.value })} /></Field>
            </div>
            <Field label="Длина окна (lookback)">
              <input className="num" value={train.lookback} onChange={(e) => setTrain({ ...train, lookback: e.target.value })} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={train.warm_start}
                onChange={(e) => setTrain({ ...train, warm_start: e.target.checked })} />
              <span>Тёплый старт (дообучить существующую модель)</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>Тип входа:</span>
              {[["0", "Маркет", "вход по рынку"], ["0.3", "Стоп", "выше/ниже рынка"], ["-0.3", "Лимит", "лучшая цена на откате"]].map(([val, label, hint]) => (
                <button key={val} type="button"
                  title={hint}
                  onClick={() => setTrain({ ...train, entry_offset_mult: val })}
                  style={{
                    padding: "5px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                    fontFamily: "var(--body)", fontWeight: 500,
                    border: `1px solid ${train.entry_offset_mult == val ? "var(--primary)" : "var(--line)"}`,
                    background: train.entry_offset_mult == val ? "var(--primary)" : "transparent",
                    color: train.entry_offset_mult == val ? "#fff" : "var(--muted)",
                    transition: "all .15s",
                  }}
                >{label}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={startTrain} disabled={busy || !online}>
                {busy && job?.kind === "train" ? "Идёт обучение…" : "Запустить обучение"}
              </button>
              {busy && job?.kind === "train" && job?.status !== "cancelling" && (
                <button className="btn ghost" onClick={stopJob}
                  style={{ width: "auto", padding: "0 20px", color: "var(--short)", borderColor: "var(--short)" }}>
                  Стоп
                </button>
              )}
            </div>
            {err ? <div className="error">{err}</div> : null}
          </div>

          <div className="card">
            <h2>Ход обучения</h2>
            <p className="sub">Прогресс по эпохам и пробный сигнал после завершения.</p>
            {job && (job.kind === "train" || job.kind === "feature_importance") ? <JobLog job={job} /> :
              <div className="empty">Задач пока нет. Запустите обучение слева.</div>}
            {trainSignal ? <div style={{ marginTop: 16 }}><SignalTicket signal={trainSignal} /></div> : null}
          </div>
        </div>
      )}

      {tab === "train" && isAdmin && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>Feature Importance</h2>
          <p className="sub">
            Permutation importance: насколько ухудшается AUC модели при случайном перемешивании каждого признака.
            Чем больше значение — тем важнее признак.
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <button className="btn" style={{ width: "auto", padding: "9px 22px" }}
              onClick={startFeatureImportance} disabled={busy || !online}>
              {busy && job?.kind === "feature_importance" ? "Считаю…" : "Рассчитать"}
            </button>
            <button className="btn ghost" style={{ width: "auto", padding: "9px 22px" }}
              onClick={loadFeatureImportance} disabled={fiLoading}>
              {fiLoading ? "Загрузка…" : "Загрузить последний"}
            </button>
          </div>

          {(fi || fiResult) && (() => {
            const data = fi || fiResult;
            const features = data.features || data.top10 || [];
            const topN = features.slice(0, 20);
            const maxImp = Math.max(...topN.map(f => Math.abs(f.importance)), 0.0001);
            return (
              <div>
                {data.base_auc != null && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                    Base AUC: <strong>{data.base_auc}</strong>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {topN.map((f, i) => (
                    <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 22, fontSize: 11, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>
                        {f.rank}
                      </div>
                      <div style={{ width: 160, fontSize: 12, fontFamily: "var(--mono)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.feature}
                      </div>
                      <div style={{ flex: 1, height: 16, background: "var(--ink-2)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 3,
                          width: `${Math.abs(f.importance) / maxImp * 100}%`,
                          background: f.importance > 0 ? "var(--primary)" : "var(--short)",
                          transition: "width .3s",
                        }} />
                      </div>
                      <div style={{ width: 60, fontSize: 11, fontFamily: "var(--mono)", color: f.importance > 0 ? "var(--long)" : "var(--short)", textAlign: "right", flexShrink: 0 }}>
                        {f.importance > 0 ? "+" : ""}{f.importance.toFixed(4)}
                      </div>
                    </div>
                  ))}
                </div>
                {features.length > 20 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                    Показано 20 из {features.length} признаков
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {tab === "classes" && isAdmin && (
        <>
          {/* карточки классов */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {Object.entries(assetClasses || {
              stocks: { label: "Акции" }, crypto: { label: "Крипта" },
              bonds: { label: "Облигации" }, forex: { label: "Forex / Металлы" },
            }).map(([cls, meta]) => {
              const trainedIntervals = Object.entries(meta.trained || {})
                .filter(([, v]) => v).map(([iv]) => iv);
              return (
                <button key={cls} onClick={() => setActiveClass(cls)} style={{
                  flex: "1 1 160px", padding: "12px 16px", borderRadius: 8,
                  border: `2px solid ${activeClass === cls ? "var(--accent)" : "var(--border)"}`,
                  background: activeClass === cls ? "var(--accent-dim, rgba(99,179,237,.12))" : "var(--card)",
                  cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</div>
                  <div style={{ fontSize: 11, opacity: .6, marginTop: 3 }}>
                    {trainedIntervals.length > 0
                      ? `Обучена: ${trainedIntervals.join(", ")}`
                      : "Не обучена"}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid">
            <div className="card">
              <h2>{assetClasses?.[activeClass]?.label || activeClass} — обучение модели</h2>
              <Field label="Инструменты">
                <SymbolTags
                  value={classTrainParams[activeClass]?.symbols || ""}
                  onChange={(v) => setClassTrainParams(p => ({
                    ...p, [activeClass]: { ...p[activeClass], symbols: v }
                  }))}
                />
              </Field>
              <div className="row3" style={{ marginTop: 10 }}>
                <Field label="Таймфрейм">
                  <select value={classTrainParams[activeClass]?.interval || "1d"}
                    onChange={(e) => setClassInterval(e.target.value)}>
                    {intervals.map((i) => <option key={i}>{i}</option>)}
                  </select>
                </Field>
                <Field label="История">
                  <input className="num" value={classTrainParams[activeClass]?.period || "6y"}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], period: e.target.value }
                    }))} />
                </Field>
                <Field label="Эпохи">
                  <input className="num" value={classTrainParams[activeClass]?.epochs || 40}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], epochs: e.target.value }
                    }))} />
                </Field>
              </div>
              <div className="row3" style={{ marginTop: 6 }}>
                <Field label="Горизонт">
                  <input className="num" value={classTrainParams[activeClass]?.horizon || 10}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], horizon: e.target.value }
                    }))} />
                </Field>
                <Field label="Длина окна">
                  <input className="num" value={classTrainParams[activeClass]?.lookback || 32}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], lookback: e.target.value }
                    }))} />
                </Field>
              </div>
              <label className="check" style={{ marginTop: 4 }}>
                <input type="checkbox" checked={classTrainParams[activeClass]?.warm_start || false}
                  onChange={(e) => setClassTrainParams(p => ({
                    ...p, [activeClass]: { ...p[activeClass], warm_start: e.target.checked }
                  }))} />
                <span>Тёплый старт (дообучить существующую модель)</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 6px", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Тип входа:</span>
                {[["0", "Маркет", "вход по рынку"], ["0.3", "Стоп", "выше/ниже рынка"], ["-0.3", "Лимит", "лучшая цена на откате"]].map(([val, label, hint]) => {
                  const cur = String(classTrainParams[activeClass]?.entry_offset_mult ?? 0);
                  const active = cur == val;
                  return (
                    <button key={val} type="button"
                      title={hint}
                      onClick={() => setClassTrainParams(p => ({
                        ...p, [activeClass]: { ...p[activeClass], entry_offset_mult: val }
                      }))}
                      style={{
                        padding: "5px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                        fontFamily: "var(--body)", fontWeight: 500,
                        border: `1px solid ${active ? "var(--primary)" : "var(--line)"}`,
                        background: active ? "var(--primary)" : "transparent",
                        color: active ? "#fff" : "var(--muted)",
                        transition: "all .15s",
                      }}
                    >{label}</button>
                  );
                })}
              </div>
              {/* Управление признаками */}
              <div style={{ marginTop: 14, borderRadius: 10, border: "1px solid var(--line)", overflow: "hidden" }}>
                <button type="button"
                  onClick={() => setFeatEditorOpen(v => !v)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px", background: "var(--ink-2)", border: "none", cursor: "pointer",
                    fontSize: 13, fontFamily: "var(--body)", fontWeight: 600, color: "var(--text)",
                  }}>
                  <span>Управление признаками</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(classTrainParams[activeClass]?.excluded_features?.length || 0) > 0 && (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--primary)", color: "#fff" }}>
                        -{classTrainParams[activeClass]?.excluded_features?.length} откл.
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{featEditorOpen ? "▲" : "▼"}</span>
                  </span>
                </button>
                {featEditorOpen && (
                  <div style={{ padding: "12px 14px", borderTop: "1px solid var(--line)" }}>
                    <FeatureEditor
                      interval={classTrainParams[activeClass]?.interval || "1d"}
                      excludedValue={featExcludedOverride}
                      onOverrideApplied={() => setFeatExcludedOverride(null)}
                      onChange={(excl) => setClassTrainParams(p => ({
                        ...p, [activeClass]: { ...p[activeClass], excluded_features: excl }
                      }))}
                    />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button className="btn" onClick={startClassTrain} disabled={busy || !online}>
                  {busy && job?.kind === "train_universal" ? "Обучение…" : `Обучить модель «${assetClasses?.[activeClass]?.label || activeClass}»`}
                </button>
                {busy && job?.kind === "train_universal" && job?.status !== "cancelling" && (
                  <button className="btn ghost" onClick={stopJob}
                    style={{ width: "auto", padding: "0 20px", color: "var(--short)", borderColor: "var(--short)" }}>
                    Стоп
                  </button>
                )}
              </div>
              {err ? <div className="error">{err}</div> : null}
            </div>

            <div className="card">
              <h2>Прогресс обучения</h2>
              {job && (job.kind === "train_universal" || job.kind === "feature_importance") ? <JobLog job={job} /> :
                <div className="empty">Выберите класс слева и запустите обучение.</div>}
              {trainSignal ? <div style={{ marginTop: 16 }}><SignalTicket signal={trainSignal} /></div> : null}
            </div>
          </div>

          {/* Feature Importance */}
          <div className="card" style={{ marginTop: 18 }}>
            <h2>Feature Importance</h2>
            <p className="sub">
              Permutation importance: насколько ухудшается AUC модели при случайном перемешивании каждого признака.
              Чем больше значение — тем важнее признак.
            </p>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn" style={{ width: "auto", padding: "9px 22px" }}
                onClick={startFeatureImportance} disabled={busy || !online}>
                {busy && job?.kind === "feature_importance" ? "Считаю…" : "Рассчитать"}
              </button>
              <button className="btn ghost" style={{ width: "auto", padding: "9px 22px" }}
                onClick={loadFeatureImportance} disabled={fiLoading}>
                {fiLoading ? "Загрузка…" : "Загрузить последний"}
              </button>
              {(fi || fiResult) && (
                <button
                  onClick={() => applyFiOptimization(0.005)}
                  style={{
                    width: "auto", padding: "9px 22px", borderRadius: 10, cursor: "pointer",
                    border: "none", fontFamily: "var(--body)", fontSize: 13, fontWeight: 600,
                    background: fiOptApplied ? "var(--long)" : "var(--primary)",
                    color: "#fff", transition: "background .3s",
                  }}
                >
                  {fiOptApplied ? "✓ Применено" : "⚡ Оптимизация"}
                </button>
              )}
            </div>

            {(fi || fiResult) && (() => {
              const data = fi || fiResult;
              const features = data.features || data.top10 || [];
              const THRESHOLD = 0.005;
              const topN = features.slice(0, 20);
              const maxImp = Math.max(...topN.map(f => Math.abs(f.importance)), 0.0001);
              return (
                <div>
                  {data.base_auc != null && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                      Base AUC: <strong>{data.base_auc}</strong>
                      <span style={{ marginLeft: 14, color: "var(--muted-2)" }}>
                        Порог оптимизации: importance &gt; {THRESHOLD}
                        {" · "}
                        оставить {features.filter(f => f.importance > THRESHOLD).length} из {features.length}
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {topN.map((f) => {
                      const weak = f.importance <= THRESHOLD;
                      return (
                        <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 10, opacity: weak ? 0.4 : 1 }}>
                          <div style={{ width: 22, fontSize: 11, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>{f.rank}</div>
                          <div style={{
                            width: 160, fontSize: 12, fontFamily: "var(--mono)", flexShrink: 0,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            textDecoration: weak ? "line-through" : "none",
                          }}>{f.feature}</div>
                          <div style={{ flex: 1, height: 16, background: "var(--ink-2)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%", borderRadius: 3,
                              width: `${Math.abs(f.importance) / maxImp * 100}%`,
                              background: f.importance > THRESHOLD ? "var(--primary)" : "var(--muted-2)",
                              transition: "width .3s",
                            }} />
                          </div>
                          <div style={{
                            width: 60, fontSize: 11, fontFamily: "var(--mono)", textAlign: "right", flexShrink: 0,
                            color: f.importance > THRESHOLD ? "var(--long)" : "var(--muted-2)",
                          }}>
                            {f.importance > 0 ? "+" : ""}{f.importance.toFixed(4)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {features.length > 20 && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                      Показано 20 из {features.length} признаков
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {tab === "backtest" && isAdmin && (
        <>
          <div className="grid">
            <div className="card">
              <h2>Walk-forward тест</h2>
              <p className="sub">Окно за окном: обучение на прошлом, проверка на будущем.</p>
              <div className="row2">
                <Field label="Инструмент"><SymbolInput value={bt.symbol} instruments={instruments} onChange={v => setBt({ ...bt, symbol: v })} /></Field>
                <Field label="Таймфрейм">
                  <select value={bt.interval} onChange={(e) => setBtInterval(e.target.value)}>
                    {intervals.map((i) => <option key={i}>{i}</option>)}
                  </select>
                </Field>
              </div>
              <div className="row3">
                <Field label="История"><input className="num" value={bt.period} onChange={(e) => setBt({ ...bt, period: e.target.value })} /></Field>
                <Field label="Train, баров"><input className="num" value={bt.train_bars} onChange={(e) => setBt({ ...bt, train_bars: e.target.value })} /></Field>
                <Field label="Test, баров"><input className="num" value={bt.test_bars} onChange={(e) => setBt({ ...bt, test_bars: e.target.value })} /></Field>
              </div>
              <div className="row3">
                <Field label="Эпохи/фолд"><input className="num" value={bt.epochs} onChange={(e) => setBt({ ...bt, epochs: e.target.value })} /></Field>
                <Field label="Комиссия"><input className="num" value={bt.commission} onChange={(e) => setBt({ ...bt, commission: e.target.value })} /></Field>
                <Field label="Проскальзывание"><input className="num" value={bt.slippage} onChange={(e) => setBt({ ...bt, slippage: e.target.value })} /></Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={bt.anchored}
                  onChange={(e) => setBt({ ...bt, anchored: e.target.checked })} />
                <span>Расширяющееся окно (anchored)</span>
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" onClick={startBacktest} disabled={busy || !online}>
                  {busy && job?.kind === "backtest" ? "Идёт тест…" : "Запустить walk-forward"}
                </button>
                {busy && job?.kind === "backtest" && job?.status !== "cancelling" && (
                  <button className="btn ghost" onClick={stopJob}
                    style={{ width: "auto", padding: "0 20px", color: "var(--short)", borderColor: "var(--short)" }}>
                    Стоп
                  </button>
                )}
              </div>
              {err ? <div className="error">{err}</div> : null}
            </div>

            <div className="card">
              <h2>Процесс</h2>
              <p className="sub">Фолды обучаются и тестируются последовательно.</p>
              {job && job.kind === "backtest" ? <JobLog job={job} /> :
                <div className="empty">Запустите тест слева, чтобы увидеть прогресс.</div>}
            </div>
          </div>

          {btResult ? (
            <div className="card" style={{ marginTop: 18 }}>
              <h2>Результат · {btResult.n_folds} фолдов</h2>
              <p className="sub">
                Чистая доходность за вычетом комиссий и проскальзывания. Это оценка, а не гарантия.
              </p>
              <WalkForwardChart folds={btResult.folds} anchored={btResult.config?.anchored} />
              <div style={{ marginTop: 18 }}>
                <MetricGrid overall={btResult.overall} />
              </div>
              <EquityChart curve={btResult.equity_curve} />

              {/* Вердикт и активация модели */}
              <WfVerdictPanel result={btResult} symbol={bt.symbol} interval={bt.interval} />
            </div>
          ) : null}
        </>
      )}

      {tab === "admin" && isAdmin && (
        <>
          <div className="card">
            <h2>Управление пользователями</h2>
            <p className="sub">
              Изменяйте квоты AI-аналитики, сроки доступа, роли и удаляйте аккаунты.
            </p>
            <AdminPanel currentUserId={currentUser?.id} />
          </div>
        </>
      )}


      <style>{`
        .hamburger { display: none; flex-direction: column; gap: 5px; background: none; border: none; cursor: pointer; padding: 6px; }
        .hamburger span { display: block; width: 22px; height: 2px; background: var(--text); border-radius: 2px; }
        .mobile-menu { display: none; }
        @media (max-width: 860px) {
          .hamburger { display: flex; }
          .mobile-menu { display: block; position: fixed; inset: 0; z-index: 200; }
          .mobile-menu-overlay { position: absolute; inset: 0; background: rgba(0,0,0,.3); }
          .mobile-menu-drawer {
            position: absolute; top: 0; right: 0; bottom: 0; width: 270px;
            background: var(--panel); box-shadow: -4px 0 24px rgba(0,0,0,.12);
            display: flex; flex-direction: column; overflow-y: auto;
          }
          .mobile-menu-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 20px 18px 14px; border-bottom: 1px solid var(--line);
          }
          .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--muted); }
          .mobile-user { padding: 14px 18px; border-bottom: 1px solid var(--line); }
          .mobile-tab {
            width: 100%; padding: 14px 18px; text-align: left;
            background: none; border: none; border-bottom: 1px solid var(--line-soft);
            font-size: 15px; cursor: pointer; color: var(--text);
            font-family: var(--body);
          }
          .mobile-tab.active { color: var(--primary); font-weight: 600; background: var(--ink-2); }
          .mobile-tab:hover { background: var(--ink-2); }
          .mobile-logout { margin: auto 18px 18px; padding: 11px 0; border-radius: 9px; border: 1.5px solid var(--short); background: none; color: var(--short); font-size: 14px; cursor: pointer; font-family: var(--body); }
        }
      `}</style>

      {tab === "screener" && (
        <Screener onScanDone={() => api.mySignals().then(d => setSignals(d.signals || [])).catch(() => {})} />
      )}

      {tab === "subscriptions" && (
        <Subscriptions />
      )}

      {tab === "notes" && <Notes />}

      {tab === "metrics" && isAdmin && (
        <div className="card">
          <h2>Нейросети</h2>
          <ModelMetrics />
        </div>
      )}

      {tab === "profile" && <ProfileTab user={currentUser} aiQuota={aiQuota} isAdmin={isAdmin} />}

      {tab === "signal" && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>Прогноз и сигнал</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 0", minWidth: 0, marginBottom: 0 }}>
                <label>Инструмент</label>
                <SymbolInput value={pred.symbol} instruments={instruments} onChange={handlePredSymbolChange} />
              </div>
              <div className="field" style={{ flex: "1 1 0", minWidth: 0, marginBottom: 0 }}>
                <label>Таймфрейм</label>
                <select value={pred.interval} onChange={(e) => setPred({ ...pred, interval: e.target.value })}>
                  {(predIntervals || intervals).map((i) => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 0", minWidth: 0, marginBottom: 0 }}>
                <label style={{ visibility: "hidden" }}>‌</label>
                <button className="btn" onClick={getSignal} disabled={busy || !online}
                  style={{ width: "100%", whiteSpace: "nowrap" }}>
                  {busy ? "Запрос…" : "Запросить прогноз"}
                </button>
              </div>
            </div>
            {err ? <div className="error">{err}</div> : null}
          </div>

          {(fc || signal) && (
            <div className="card" style={{ marginBottom: 18 }}>
              {fc && <ForecastChart data={fc} isAdmin={isAdmin} />}
              {signal && !fc && (
                <>
                  <h2>Торговый тикет</h2>
                  <SignalTicket signal={signal} />
                </>
              )}
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line-soft)" }}>
                <AIAnalysis
                  symbol={pred.symbol}
                  signal={signal}
                  signalId={currentSignalId}
                  quota={aiQuota}
                  onQuotaUpdate={setAiQuota}
                />
              </div>
            </div>
          )}

          <HistoryPanel
            signals={signals}
            onDeleteSignal={deleteSignal}
            onSelectSignal={viewSignalChart}
            activeSignalId={historyFc?.signal_id}
          />

          {historyFc && (
            <div className="card" style={{ marginTop: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Прогноз из истории</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={loadActuals}
                    disabled={actualsLoading}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 8, fontSize: 13,
                      border: "1px solid var(--primary)", background: "rgba(59,111,240,.08)",
                      color: "var(--primary)", cursor: actualsLoading ? "not-allowed" : "pointer",
                      opacity: actualsLoading ? 0.6 : 1, fontFamily: "var(--body)",
                    }}
                  >
                    {actualsLoading
                      ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Загрузка…</>
                      : historyFc.actuals?.length
                        ? `↻ Обновить котировки (${historyFc.actuals.length} баров)`
                        : "↓ Подкачать котировки"
                    }
                  </button>
                  <button onClick={() => setHistoryFc(null)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 18 }}>✕</button>
                </div>
              </div>
              {historyFc.actuals?.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span>Реальные котировки: <strong style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>{historyFc.actuals.length}</strong> баров</span>
                  {historyFc.order_result && <OrderResultBadge r={historyFc.order_result} />}
                </div>
              )}
              <ForecastChart data={historyFc} isAdmin={isAdmin} actuals={historyFc.actuals} />
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line-soft)" }}>
                <AIAnalysis
                  symbol={historyFc.symbol}
                  signal={historyFc.signal}
                  signalId={historyFc.signal_id}
                  quota={aiQuota}
                  onQuotaUpdate={setAiQuota}
                />
              </div>
            </div>
          )}
        </>
      )}
      </main>
    </div>
  );
}

// ─── Профиль как встроенная вкладка ───────────────────────────────────────
function ProfileTab({ user, aiQuota, isAdmin }) {
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confPw, setConfPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState("");
  const [delLoading, setDelLoading] = useState(false);
  const [delErr, setDelErr] = useState("");

  const [payLoading, setPayLoading] = useState(false);
  const [payErr, setPayErr] = useState("");

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
    } catch (e) { setPwErr(e.message); }
    setPwLoading(false);
  }

  async function deleteAccount() {
    if (delConfirm !== "УДАЛИТЬ") return;
    setDelLoading(true); setDelErr("");
    try {
      await api.deleteOwnAccount();
      logout();
    } catch (e) {
      setDelErr(e.message);
      setDelLoading(false);
    }
  }

  async function handlePayment() {
    setPayLoading(true); setPayErr("");
    try {
      const { url } = await api.paymentInit();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setPayErr(e.message);
    }
    setPayLoading(false);
  }

  if (!user) return null;
  const quotaPct = aiQuota && !isAdmin ? Math.min(100, (aiQuota.used / aiQuota.limit) * 100) : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18, alignItems: "start" }}
      className="profile-grid">

      {/* левая колонка */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card">
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: isAdmin ? "var(--primary)" : "var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, color: isAdmin ? "#fff" : "var(--muted)", marginBottom: 14 }}>
            {(user.name || user.email || "?")[0].toUpperCase()}
          </div>
          {[
            ["Имя", user.name || "—"],
            ["Email", user.email],
            ["Роль", isAdmin ? "Администратор" : "Пользователь"],
            ["Регистрация", user.created_at ? new Date(user.created_at).toLocaleDateString("ru-RU") : "—"],
          ].map(([k, v]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        {aiQuota && (
          <div className="card">
            <h2>AI-лимит</h2>
            {isAdmin
              ? <div style={{ color: "var(--long)", fontWeight: 600, marginTop: 8 }}>∞ Без ограничений</div>
              : <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: "var(--muted)" }}>Использовано</span>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{aiQuota.used} / {aiQuota.limit}</span>
                  </div>
                  <div style={{ height: 5, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 4, background: aiQuota.remaining === 0 ? "var(--short)" : "var(--primary)", width: `${quotaPct}%` }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5 }}>
                    Осталось: <strong style={{ color: aiQuota.remaining === 0 ? "var(--short)" : "var(--long)" }}>{aiQuota.remaining}</strong>
                  </div>
                </>
            }
          </div>
        )}

        {!isAdmin && (
          <div className="card" style={{ border: "1px solid var(--primary)" }}>
            <h2 style={{ marginBottom: 6 }}>Доступ к терминалу</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 6px" }}>
              {user.access_until
                ? <>Активен до: <strong style={{ color: "var(--long)" }}>{new Date(user.access_until).toLocaleDateString("ru-RU")}</strong></>
                : <span style={{ color: "var(--muted)" }}>Доступ не ограничен</span>}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted-2)", margin: "0 0 14px" }}>
              Квартал (92 дня) — <strong style={{ color: "var(--text)" }}>15 000 ₽</strong>
            </p>
            {payErr && <div className="error" style={{ marginBottom: 10 }}>{payErr}</div>}
            <button onClick={handlePayment} disabled={payLoading} className="btn"
              style={{ background: "var(--primary)", color: "#fff" }}>
              {payLoading ? "Создание счёта…" : "Оплатить через Robokassa"}
            </button>
          </div>
        )}

        <div className="card">
          <button onClick={logout} className="btn" style={{ background: "var(--short-dim)", border: "1px solid var(--short)", color: "var(--short)" }}>
            Выйти из аккаунта
          </button>
        </div>

        <div className="card" style={{ border: "1px solid var(--short)" }}>
          <h2 style={{ color: "var(--short)", marginBottom: 8 }}>Удаление аккаунта</h2>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
            Удаляет аккаунт, все прогнозы, историю и AI-анализы без возможности восстановления.
          </p>
          <button onClick={() => { setDelOpen(true); setDelConfirm(""); setDelErr(""); }}
            className="btn" style={{ background: "none", border: "1px solid var(--short)", color: "var(--short)" }}>
            Удалить аккаунт
          </button>
        </div>
      </div>

      {/* правая колонка — смена пароля */}
      <div className="card">
        <h2>Смена пароля</h2>
        <p className="sub">Новый пароль вступает в силу немедленно. Минимум 6 символов.</p>
        <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
          {pwMsg && <div style={{ background: "var(--long-dim)", border: "1px solid var(--long)", color: "var(--long)", borderRadius: 9, padding: "10px 14px", fontSize: 13 }}>✓ {pwMsg}</div>}
          {pwErr && <div className="error">{pwErr}</div>}
          <div className="field"><label>Текущий пароль</label><input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} required /></div>
          <div className="field"><label>Новый пароль</label><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required /></div>
          <div className="field"><label>Повторите новый пароль</label><input type="password" value={confPw} onChange={e => setConfPw(e.target.value)} required /></div>
          {newPw && confPw && newPw !== confPw && <div style={{ fontSize: 12, color: "var(--short)", marginTop: -6 }}>Пароли не совпадают</div>}
          {newPw && confPw && newPw === confPw && newPw.length >= 6 && <div style={{ fontSize: 12, color: "var(--long)", marginTop: -6 }}>✓ Совпадают</div>}
          <button type="submit" className="btn" disabled={pwLoading}>{pwLoading ? "Сохранение…" : "Сменить пароль"}</button>
        </form>
      </div>

      {/* Модальное окно подтверждения удаления */}
      {delOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,.55)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }} onClick={e => { if (e.target === e.currentTarget) setDelOpen(false); }}>
          <div style={{
            background: "var(--panel)", borderRadius: 16,
            border: "1.5px solid var(--short)",
            padding: "28px 28px 24px", maxWidth: 440, width: "100%",
            boxShadow: "0 8px 40px rgba(0,0,0,.22)",
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>⚠️</div>
            <h2 style={{ margin: "0 0 10px", color: "var(--short)", fontFamily: "var(--display)", fontSize: 17, letterSpacing: "0.04em" }}>
              УДАЛЕНИЕ АККАУНТА
            </h2>
            <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.6, margin: "0 0 16px" }}>
              Это действие <strong>необратимо</strong>. Будут удалены:
            </p>
            <ul style={{ margin: "0 0 18px", padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
              {["Ваш аккаунт и данные профиля", "Все прогнозы и история сигналов", "Все AI-анализы", "Все подписки на инструменты"].map(item => (
                <li key={item} style={{ fontSize: 13, color: "var(--muted)" }}>{item}</li>
              ))}
            </ul>
            <div style={{ background: "rgba(220,38,38,.07)", border: "1px solid rgba(220,38,38,.25)", borderRadius: 10, padding: "12px 14px", marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: "var(--short)", fontWeight: 600, marginBottom: 8, letterSpacing: "0.04em" }}>
                Для подтверждения введите слово УДАЛИТЬ
              </div>
              <input
                value={delConfirm}
                onChange={e => setDelConfirm(e.target.value)}
                placeholder="УДАЛИТЬ"
                autoFocus
                style={{
                  width: "100%", background: "var(--ink-2)", border: "1.5px solid var(--short)",
                  borderRadius: 8, padding: "9px 12px", fontSize: 14, fontFamily: "var(--mono)",
                  color: "var(--text)", outline: "none", letterSpacing: "0.08em",
                }}
              />
            </div>
            {delErr && <div className="error" style={{ marginBottom: 14 }}>{delErr}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDelOpen(false)}
                className="btn ghost" style={{ flex: 1 }}>
                Отмена
              </button>
              <button
                onClick={deleteAccount}
                disabled={delConfirm !== "УДАЛИТЬ" || delLoading}
                className="btn"
                style={{ flex: 1, background: delConfirm === "УДАЛИТЬ" ? "var(--short)" : "var(--short-dim)", color: "#fff", opacity: delConfirm !== "УДАЛИТЬ" ? 0.5 : 1 }}>
                {delLoading ? "Удаление…" : "Удалить навсегда"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
