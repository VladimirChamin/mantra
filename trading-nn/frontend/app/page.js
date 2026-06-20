"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import SignalTicket from "@/components/SignalTicket";
import ForecastChart from "@/components/ForecastChart";
import MetricGrid from "@/components/MetricGrid";
import EquityChart from "@/components/EquityChart";
import JobLog from "@/components/JobLog";

const DEFAULT_INTERVALS = ["1d", "4h", "1h"];

function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState("train");
  const [health, setHealth] = useState(null);
  const [online, setOnline] = useState(false);
  const [meta, setMeta] = useState(null);

  // источник данных
  const [provider, setProvider] = useState("yfinance");
  const [tinvestToken, setTinvestToken] = useState("");
  const [bybitCategory, setBybitCategory] = useState("spot");
  const [fdApiKey, setFdApiKey] = useState("");
  const [srcMsg, setSrcMsg] = useState("");
  const [srcErr, setSrcErr] = useState("");

  // обучение по классам активов
  const [assetClasses, setAssetClasses] = useState(null);
  const [activeClass, setActiveClass] = useState("stocks");
  const [classTrainParams, setClassTrainParams] = useState({
    stocks:    { interval: "1d", epochs: 40, symbols: "SBER GAZP LKOH GMKN ROSN NVTK TATN MGNT YDEX MOEX" },
    crypto:    { interval: "1d", epochs: 40, symbols: "BTCUSDT ETHUSDT SOLUSDT BNBUSDT XRPUSDT ADAUSDT" },
    bonds:     { interval: "1d", epochs: 40, symbols: "SU26238RMFS4 SU26240RMFS0 SU26233RMFS5" },
    forex:     { interval: "1d", epochs: 40, symbols: "EURUSD GBPUSD USDJPY USDRUB EURRUB" },
    commodity: { interval: "1d", epochs: 40, symbols: "XAUUSD XAGUSD CL NG BRENT ZC ZW ZS" },
  });

  // формы (дефолты — дневной таймфрейм, индекс Мосбиржи)
  const [train, setTrain] = useState({
    symbol: "IMOEX", interval: "1d", period: "6y",
    epochs: 40, horizon: 6, lookback: 50, warm_start: false,
  });
  const [bt, setBt] = useState({
    symbol: "IMOEX", interval: "1d", period: "6y",
    train_bars: 700, test_bars: 120, epochs: 15, horizon: 6, lookback: 50,
    anchored: false, commission: 0.0005, slippage: 0.0005,
  });
  const [pred, setPred] = useState({ symbol: "IMOEX", interval: "1d" });
  const [signal, setSignal] = useState(null);
  const [fc, setFc] = useState(null);

  const intervals = meta?.intervals || DEFAULT_INTERVALS;
  const instruments = meta?.instruments || [];

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

  // состояние backend
  async function refreshHealth() {
    try {
      const h = await api.health();
      setHealth(h);
      setOnline(true);
      if (h.data_source) {
        const ds = h.data_source;
        if (ds.startsWith("tinvest")) setProvider("tinvest");
        else if (ds.startsWith("bybit")) setProvider("bybit");
        else if (ds.startsWith("financialdata")) setProvider("financialdata");
        else setProvider("yfinance");
      }
    } catch {
      setOnline(false);
    }
  }
  useEffect(() => {
    refreshHealth();
    api.meta().then(setMeta).catch(() => {});
    api.assetClasses().then(setAssetClasses).catch(() => {});
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
        if (j.status === "done" || j.status === "error") {
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

  async function applySource() {
    setSrcMsg(""); setSrcErr("");
    try {
      const payload = { provider };
      if (provider === "tinvest") payload.token = tinvestToken || undefined;
      if (provider === "bybit") payload.category = bybitCategory;
      if (provider === "financialdata") payload.api_key = fdApiKey || undefined;
      const r = await api.setDataSource(provider, payload);
      setSrcMsg(`Подключено: ${r.data_source}`);
      refreshHealth();
    } catch (e) {
      setSrcErr(e.message);
    }
  }

  async function startTrain() {
    setErr(""); setBusy(true); setJob(null);
    try {
      const r = await api.train({
        ...train,
        epochs: +train.epochs, horizon: +train.horizon, lookback: +train.lookback,
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
      });
      watch(r.job_id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function getSignal() {
    setErr(""); setBusy(true); setSignal(null); setFc(null);
    try {
      const f = await api.forecast({ ...pred, steps: 10, history: 50 });
      setFc(f);
      setSignal(f.signal);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const btResult = job && job.kind === "backtest" && job.status === "done" ? job.result : null;
  const trainSignal = job && job.kind === "train" && job.status === "done" ? job.result?.signal : null;

  return (
    <div className="shell">
      <datalist id="moex">
        {instruments.map((i) => (
          <option key={i.ticker} value={i.ticker}>{i.name}</option>
        ))}
      </datalist>
      <div className="topbar">
        <div className="brand">
          <h1>Нейротерминал</h1>
          <span className="tick">tf · gru · triple-barrier</span>
        </div>
        <div className="status">
          <span className="src-pill">{health ? health.data_source : "—"}</span>
          <span>моделей: {health ? health.models : "—"}</span>
          <span>
            <span className={`dot ${online ? "live" : "down"}`} />{" "}
            {online ? "backend на связи" : "backend недоступен"}
          </span>
        </div>
      </div>

      <div className="tabs">
        {[["train", "Обучение"], ["classes", "Классы активов"], ["backtest", "Walk-forward"], ["signal", "Сигнал"]].map(
          ([k, label]) => (
            <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
              {label}
            </button>
          )
        )}
      </div>

      {/* источник данных */}
      <div className="card" style={{ marginBottom: 18 }}>
        <span className="eyebrow">Источник данных</span>

        {/* карточки-провайдеры */}
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          {[
            { id: "yfinance",       label: "Yahoo Finance",     sub: "Бесплатно, без ключа" },
            { id: "tinvest",        label: "T-Invest",          sub: "Мосбиржа · токен API" },
            { id: "bybit",          label: "Bybit",             sub: "Крипто · без ключа" },
            { id: "financialdata",  label: "FinancialData.net", sub: "Акции/форекс · API key" },
          ].map(({ id, label, sub }) => (
            <button
              key={id}
              onClick={() => setProvider(id)}
              style={{
                flex: "1 1 160px",
                padding: "10px 14px",
                borderRadius: 8,
                border: `2px solid ${provider === id ? "var(--accent)" : "var(--border)"}`,
                background: provider === id ? "var(--accent-dim, rgba(99,179,237,.12))" : "var(--card)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color .15s",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
              <div style={{ fontSize: 11, opacity: .6, marginTop: 2 }}>{sub}</div>
            </button>
          ))}
        </div>

        {/* поля по провайдеру */}
        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          {provider === "tinvest" && (
            <Field label="Токен T-Invest">
              <input type="password" placeholder="t.xxxxxxxxxxxxxxxx"
                value={tinvestToken} onChange={(e) => setTinvestToken(e.target.value)}
                style={{ minWidth: 260 }} />
            </Field>
          )}
          {provider === "bybit" && (
            <Field label="Тип рынка Bybit">
              <select value={bybitCategory} onChange={(e) => setBybitCategory(e.target.value)}>
                <option value="spot">Spot</option>
                <option value="linear">Linear (USDT-перп)</option>
                <option value="inverse">Inverse</option>
              </select>
            </Field>
          )}
          {provider === "financialdata" && (
            <Field label="API Key (financialdata.net)">
              <input type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={fdApiKey} onChange={(e) => setFdApiKey(e.target.value)}
                style={{ minWidth: 280 }} />
            </Field>
          )}
          {provider === "yfinance" && (
            <p className="sub" style={{ margin: 0 }}>
              Данные загружаются автоматически — ключ не нужен.
            </p>
          )}
          <button className="btn ghost" onClick={applySource} style={{ alignSelf: "end" }}>
            Применить
          </button>
        </div>

        {srcMsg && <div className="eyebrow" style={{ color: "var(--long)", marginTop: 8 }}>{srcMsg}</div>}
        {srcErr && <div className="error" style={{ marginTop: 8 }}>{srcErr}</div>}
      </div>

      {tab === "train" && (
        <div className="grid">
          <div className="card">
            <h2>Параметры обучения</h2>
            <p className="sub">Модель обучается на истории и сохраняется на сервере.</p>
            <div className="row2">
              <Field label="Инструмент">
                <input list="moex" value={train.symbol} onChange={(e) => setTrain({ ...train, symbol: e.target.value })} />
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
            <button className="btn" onClick={startTrain} disabled={busy || !online}>
              {busy ? "Идёт обучение…" : "Запустить обучение"}
            </button>
            {err ? <div className="error">{err}</div> : null}
          </div>

          <div className="card">
            <h2>Ход обучения</h2>
            <p className="sub">Прогресс по эпохам и пробный сигнал после завершения.</p>
            {job && job.kind === "train" ? <JobLog job={job} /> :
              <div className="empty">Задач пока нет. Запустите обучение слева.</div>}
            {trainSignal ? <div style={{ marginTop: 16 }}><SignalTicket signal={trainSignal} /></div> : null}
          </div>
        </div>
      )}

      {tab === "classes" && (
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
              <p className="sub">
                Одна модель на весь класс. При запросе прогноза сервис автоматически
                выберет нужную сеть по тикеру.
              </p>
              <Field label="Инструменты (через пробел или запятую)">
                <textarea rows={3}
                  value={classTrainParams[activeClass]?.symbols || ""}
                  onChange={(e) => setClassTrainParams(p => ({
                    ...p, [activeClass]: { ...p[activeClass], symbols: e.target.value }
                  }))}
                  style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 13 }}
                />
              </Field>
              <div className="row2" style={{ marginTop: 10 }}>
                <Field label="Таймфрейм">
                  <select value={classTrainParams[activeClass]?.interval || "1d"}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], interval: e.target.value }
                    }))}>
                    {intervals.map((i) => <option key={i}>{i}</option>)}
                  </select>
                </Field>
                <Field label="Эпохи">
                  <input className="num" value={classTrainParams[activeClass]?.epochs || 40}
                    onChange={(e) => setClassTrainParams(p => ({
                      ...p, [activeClass]: { ...p[activeClass], epochs: e.target.value }
                    }))} />
                </Field>
              </div>
              <button className="btn" onClick={startClassTrain} disabled={busy || !online}>
                {busy ? "Обучение…" : `Обучить модель «${assetClasses?.[activeClass]?.label || activeClass}»`}
              </button>
              {err ? <div className="error">{err}</div> : null}
            </div>

            <div className="card">
              <h2>Прогресс</h2>
              <p className="sub">
                Сервис автоматически определит класс актива при запросе прогноза.
                Приоритет: индивидуальная модель → модель класса → универсальная.
              </p>
              {job && job.kind === "train_universal" ? <JobLog job={job} /> :
                <div className="empty">Выберите класс слева и запустите обучение.</div>}
            </div>
          </div>
        </>
      )}

      {tab === "backtest" && (
        <>
          <div className="grid">
            <div className="card">
              <h2>Walk-forward тест</h2>
              <p className="sub">Окно за окном: обучение на прошлом, проверка на будущем.</p>
              <div className="row2">
                <Field label="Инструмент"><input list="moex" value={bt.symbol} onChange={(e) => setBt({ ...bt, symbol: e.target.value })} /></Field>
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
              <button className="btn" onClick={startBacktest} disabled={busy || !online}>
                {busy ? "Идёт тест…" : "Запустить walk-forward"}
              </button>
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
              <MetricGrid overall={btResult.overall} />
              <EquityChart curve={btResult.equity_curve} />
            </div>
          ) : null}
        </>
      )}

      {tab === "signal" && (
        <>
          <div className="grid">
            <div className="card">
              <h2>Прогноз и сигнал</h2>
              <p className="sub">Модель оценивает последнее окно: выдаёт вход / стоп / тейк и строит прогноз на 10 баров.</p>
              <div className="row2">
                <Field label="Инструмент"><input list="moex" value={pred.symbol} onChange={(e) => setPred({ ...pred, symbol: e.target.value })} /></Field>
                <Field label="Таймфрейм">
                  <select value={pred.interval} onChange={(e) => setPred({ ...pred, interval: e.target.value })}>
                    {intervals.map((i) => <option key={i}>{i}</option>)}
                  </select>
                </Field>
              </div>
              <button className="btn" onClick={getSignal} disabled={busy || !online}>
                {busy ? "Запрос…" : "Запросить прогноз"}
              </button>
              {err ? <div className="error">{err}</div> : null}
            </div>

            <div className="card">
              <h2>Торговый тикет</h2>
              <p className="sub">Уровни рассчитаны из прогноза волатильности модели.</p>
              <SignalTicket signal={signal} />
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <h2>График прогноза</h2>
            <p className="sub">
              Прогнозный отросток — ожидаемая траектория к горизонту; конус показывает
              рост неопределённости как vol·√t. Линии — ориентиры входа, стопа и тейка.
            </p>
            <ForecastChart data={fc} />
          </div>
        </>
      )}
    </div>
  );
}
