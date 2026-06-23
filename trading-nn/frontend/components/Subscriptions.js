"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const SYMBOLS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT",
  "SBER","GAZP","LKOH","GMKN","ROSN","NVTK","YDEX",
  "XAUUSD","XAGUSD","EURUSD","GBPUSD","USDJPY",
  "IMOEX",
];
const INTERVALS = [
  { v: "1d", l: "1D — дневной" },
  { v: "4h", l: "4H — четырёхчасовой" },
];
const CHANNELS = [
  { v: "telegram", l: "Telegram" },
  { v: "email", l: "Email" },
];
const DIR_COLOR = { LONG: "var(--long)", SHORT: "var(--short)", FLAT: "var(--muted)" };

function EditForm({ sub, onSave, onCancel }) {
  const [form, setForm] = useState({
    symbol:           sub.symbol,
    interval:         sub.interval,
    channel:          sub.channel,
    destination:      sub.destination,
    direction_filter: sub.direction_filter,
    min_prob:         Math.round((sub.min_prob ?? 0.6) * 100),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.destination.trim()) { setErr("Укажите адрес доставки"); return; }
    setSaving(true); setErr("");
    try {
      const updated = await api.updateSubscription(sub.id, {
        ...form,
        min_prob: form.min_prob / 100,
      });
      onSave(updated);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0 4px" }}>
      {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <div className="field">
          <label>Актив</label>
          <input value={form.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())}
            style={{ textTransform: "uppercase" }} />
        </div>
        <div className="field">
          <label>Таймфрейм</label>
          <select value={form.interval} onChange={e => set("interval", e.target.value)}>
            {INTERVALS.map(i => <option key={i.v} value={i.v}>{i.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Фильтр направления</label>
          <select value={form.direction_filter} onChange={e => set("direction_filter", e.target.value)}>
            <option value="any">Любое</option>
            <option value="LONG">Только LONG</option>
            <option value="SHORT">Только SHORT</option>
          </select>
        </div>
        <div className="field">
          <label>Мин. P(up), %</label>
          <input type="number" className="num" min={0} max={100} value={form.min_prob}
            onChange={e => set("min_prob", +e.target.value)} />
        </div>
        <div className="field">
          <label>Канал</label>
          <select value={form.channel} onChange={e => set("channel", e.target.value)}>
            {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{form.channel === "telegram" ? "Chat ID / @username" : "Email"}</label>
          <input type={form.channel === "email" ? "email" : "text"}
            value={form.destination} onChange={e => set("destination", e.target.value)}
            placeholder={form.channel === "telegram" ? "@username или 123456789" : "you@example.com"} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={save} disabled={saving}
          style={{ width: "auto", padding: "7px 20px", fontSize: 13 }}>
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
        <button className="btn ghost" onClick={onCancel}
          style={{ width: "auto", padding: "7px 16px", fontSize: 13 }}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);

  // форма добавления
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [customSymbol, setCustomSymbol] = useState("");
  const [interval, setInterval] = useState("1d");
  const [channel, setChannel] = useState("telegram");
  const [dest, setDest] = useState("");
  const [dirFilter, setDirFilter] = useState("any");
  const [minProb, setMinProb] = useState(60);
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { loadSubs(); }, []);

  async function loadSubs() {
    setLoading(true);
    try {
      const data = await api.getSubscriptions();
      setSubs(data.subscriptions || []);
    } catch {
      setSubs([]);
    }
    setLoading(false);
  }

  async function addSub(e) {
    e.preventDefault();
    setAddErr(""); setAddOk("");
    const sym = (customSymbol.trim() || symbol).toUpperCase();
    if (!dest.trim()) { setAddErr("Укажите адрес доставки"); return; }
    setAdding(true);
    try {
      await api.addSubscription({
        symbol: sym, interval, channel,
        destination: dest.trim(),
        direction_filter: dirFilter,
        min_prob: minProb / 100,
      });
      setAddOk(`Подписка на ${sym} ${interval} добавлена`);
      setCustomSymbol(""); setDest("");
      await loadSubs();
    } catch (e) {
      setAddErr(e.message);
    }
    setAdding(false);
  }

  async function deleteSub(id) {
    try {
      await api.deleteSubscription(id);
      setSubs(s => s.filter(x => x.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (e) {
      alert(e.message);
    }
  }

  async function toggleSub(id, active) {
    try {
      await api.toggleSubscription(id, !active);
      setSubs(s => s.map(x => x.id === id ? { ...x, active: !active } : x));
    } catch (e) {
      alert(e.message);
    }
  }

  function handleSaved(updated) {
    setSubs(s => s.map(x => x.id === updated.id ? updated : x));
    setEditingId(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Добавить подписку */}
      <div className="card">
        <h2>Подписки на сигналы</h2>
        <p className="sub">
          Сервис анализирует каждую новую свечу. При появлении сигнала — отправляет уведомление.
        </p>

        <form onSubmit={addSub} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {addOk && (
            <div style={{ background: "rgba(45,212,167,.1)", border: "1px solid rgba(45,212,167,.3)", color: "var(--long)", borderRadius: 9, padding: "10px 14px", fontSize: 13 }}>
              {addOk}
            </div>
          )}
          {addErr && <div className="error">{addErr}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field">
              <label>Актив (список)</label>
              <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                {SYMBOLS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Или введите тикер</label>
              <input type="text" value={customSymbol} onChange={e => setCustomSymbol(e.target.value)}
                placeholder="AAPL, NVDA, …" style={{ textTransform: "uppercase" }} />
            </div>
            <div className="field">
              <label>Таймфрейм</label>
              <select value={interval} onChange={e => setInterval(e.target.value)}>
                {INTERVALS.map(i => <option key={i.v} value={i.v}>{i.l}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field">
              <label>Фильтр направления</label>
              <select value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                <option value="any">Любое (LONG + SHORT)</option>
                <option value="LONG">Только LONG</option>
                <option value="SHORT">Только SHORT</option>
              </select>
            </div>
            <div className="field">
              <label>Мин. P(up), %</label>
              <input type="number" className="num" min={0} max={100} value={minProb}
                onChange={e => setMinProb(+e.target.value)} />
            </div>
            <div className="field">
              <label>Канал уведомления</label>
              <select value={channel} onChange={e => setChannel(e.target.value)}>
                {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{channel === "telegram" ? "Telegram Chat ID или @username" : "Email адрес"}</label>
              <input type={channel === "email" ? "email" : "text"}
                value={dest} onChange={e => setDest(e.target.value)}
                placeholder={channel === "telegram" ? "@username или 123456789" : "you@example.com"} />
            </div>
          </div>

          {channel === "telegram" && (
            <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--ink)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px" }}>
              Чтобы получать уведомления, напишите боту <strong style={{ color: "var(--primary)" }}>@MantraTradingBot</strong> команду <code>/start</code>, затем укажите свой Chat ID или @username выше.
            </div>
          )}

          <button type="submit" className="btn" disabled={adding} style={{ maxWidth: 220 }}>
            {adding ? "Добавление…" : "Добавить подписку"}
          </button>
        </form>
      </div>

      {/* Список подписок */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>Мои подписки</h2>
            <p className="sub" style={{ margin: "4px 0 0" }}>Активных: {subs.filter(s => s.active).length} из {subs.length}</p>
          </div>
          <button className="btn ghost" onClick={loadSubs} style={{ width: "auto", padding: "7px 14px", fontSize: 13 }}>
            Обновить
          </button>
        </div>

        {loading ? (
          <div className="empty">Загрузка…</div>
        ) : subs.length === 0 ? (
          <div className="empty">Подписок нет. Добавьте первую выше.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {subs.map(s => (
              <div key={s.id} style={{
                background: "var(--ink)", border: `1px solid ${editingId === s.id ? "var(--primary)" : s.active ? "var(--line)" : "var(--line-soft)"}`,
                borderRadius: 10, padding: "12px 14px",
                opacity: s.active ? 1 : 0.55,
                transition: "border-color .15s",
              }}>
                {/* Шапка строки */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 200 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontFamily: "var(--mono)", fontSize: 14 }}>
                        {s.symbol}
                        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)", fontFamily: "var(--body)" }}>{s.interval}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        {s.channel === "telegram" ? "📱" : "✉️"} {s.destination}
                        {s.direction_filter !== "any" && (
                          <span style={{ marginLeft: 8, color: DIR_COLOR[s.direction_filter] }}>
                            {s.direction_filter} only
                          </span>
                        )}
                        {" · "}мин. {(s.min_prob * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {s.last_signal_at && (
                      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
                        <div>Последний сигнал</div>
                        <div style={{ color: DIR_COLOR[s.last_signal_dir], fontWeight: 600 }}>{s.last_signal_dir}</div>
                        <div>{new Date(s.last_signal_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    )}
                    <button onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                      style={{
                        background: editingId === s.id ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "var(--ink-2)",
                        border: `1px solid ${editingId === s.id ? "var(--primary)" : "var(--line)"}`,
                        borderRadius: 7, padding: "5px 11px",
                        color: editingId === s.id ? "var(--primary)" : "var(--muted-2)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>
                      {editingId === s.id ? "Закрыть" : "Изменить"}
                    </button>
                    <button onClick={() => toggleSub(s.id, s.active)}
                      style={{
                        background: s.active ? "var(--long-dim)" : "var(--line)",
                        border: "none", borderRadius: 7, padding: "6px 12px",
                        color: s.active ? "var(--long)" : "var(--muted)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>
                      {s.active ? "Активна" : "Пауза"}
                    </button>
                    <button onClick={() => deleteSub(s.id)}
                      style={{
                        background: "var(--short-dim)", border: "none", borderRadius: 7,
                        padding: "6px 12px", color: "var(--short)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>
                      Удалить
                    </button>
                  </div>
                </div>

                {/* Форма редактирования — раскрывается inline */}
                {editingId === s.id && (
                  <EditForm
                    sub={s}
                    onSave={handleSaved}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
