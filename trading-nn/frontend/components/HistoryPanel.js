"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { AnalysisResult } from "@/components/AIAnalysis";

// ── цвет вердикта ─────────────────────────────────────────────────────────────
function verdictColor(v) {
  if (!v) return "var(--muted-2)";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "var(--long)";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "var(--short)";
  return "var(--muted-2)";
}
function verdictLabel(v) {
  if (!v) return "—";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "✓ Подтверждает";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "✗ Противоречит";
  return "~ Нейтрально";
}

const DIR_COLOR = { LONG: "var(--long)", SHORT: "var(--short)", FLAT: "var(--muted)" };

// ── PDF экспорт (через print CSS) ────────────────────────────────────────────
function exportPdf(contentRef, title) {
  const el = contentRef.current;
  if (!el) return;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.5;
      color: #1a1a2e; background: #fff; padding: 32px 40px;
    }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; color: #111; }
    h2 { font-size: 15px; font-weight: 700; margin: 18px 0 8px; color: #222; }
    h3 { font-size: 13px; font-weight: 600; margin: 14px 0 6px; color: #333; }
    .meta { font-size: 11px; color: #666; margin-bottom: 24px; }
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 5px;
      font-size: 11px; font-weight: 700; border: 1px solid;
    }
    .long  { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
    .short { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
    .flat  { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }
    .confirm { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
    .contra  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
    .neutral { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
    th { font-weight: 600; background: #f9fafb; }
    .mono { font-family: monospace; }
    .section { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    ul { padding-left: 18px; }
    li { margin-bottom: 4px; }
    p { margin: 6px 0; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    @media print {
      body { padding: 16px 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  ${el.innerHTML}
  <p class="meta" style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:8px;">
    Сгенерировано ${new Date().toLocaleString("ru-RU")} · Mantra Trading NN
  </p>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.print(); };
}

// ── Строка сигнала ─────────────────────────────────────────────────────────────
function SignalRow({ s, active, onSelect, onDelete }) {
  return (
    <tr onClick={() => s.forecast_json && onSelect(s)}
      style={{
        borderBottom: "1px solid var(--line)",
        background: active ? "var(--ink-2)" : "transparent",
        cursor: s.forecast_json ? "pointer" : "default",
        transition: "background .1s",
      }}
      onMouseEnter={e => !active && (e.currentTarget.style.background = "var(--panel-2)")}
      onMouseLeave={e => !active && (e.currentTarget.style.background = "")}
    >
      <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12 }}>
        {s.created_at ? new Date(s.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
      </td>
      <td style={{ padding: "7px 10px", fontWeight: 700, fontFamily: "var(--mono)" }}>{s.symbol || "—"}</td>
      <td style={{ padding: "7px 10px", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>{s.interval || "—"}</td>
      <td style={{ padding: "7px 10px", fontWeight: 700, color: DIR_COLOR[s.direction] || "var(--muted)" }}>
        {s.direction || "—"}
      </td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>
        {s.entry != null ? s.entry.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
      </td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--short)" }}>
        {s.stop_loss != null ? s.stop_loss.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
      </td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--long)" }}>
        {s.take_profit != null ? s.take_profit.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}
      </td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>
        {s.prob_up != null ? `${(s.prob_up * 100).toFixed(1)}%` : "—"}
      </td>
      <td style={{ padding: "7px 4px", textAlign: "right" }}>
        <button onClick={e => { e.stopPropagation(); onDelete(s.id); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 15, padding: "2px 6px", borderRadius: 5 }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--short)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
        >✕</button>
      </td>
    </tr>
  );
}

// ── PDF-шаблон для прогноза ───────────────────────────────────────────────────
function SignalPdfContent({ signals }) {
  return (
    <div>
      <h1>История прогнозов</h1>
      <p className="meta">{signals.length} записей</p>
      <table>
        <thead>
          <tr>
            <th>Дата</th><th>Актив</th><th>ТФ</th><th>Направление</th>
            <th>Вход</th><th>SL</th><th>TP</th><th>P(up)</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(s => (
            <tr key={s.id}>
              <td>{s.created_at ? new Date(s.created_at).toLocaleString("ru-RU") : "—"}</td>
              <td className="mono" style={{ fontWeight: 700 }}>{s.symbol}</td>
              <td className="mono">{s.interval}</td>
              <td>
                <span className={`badge ${s.direction === "LONG" ? "long" : s.direction === "SHORT" ? "short" : "flat"}`}>
                  {s.direction}
                </span>
              </td>
              <td className="mono">{s.entry != null ? s.entry.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}</td>
              <td className="mono">{s.stop_loss != null ? s.stop_loss.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}</td>
              <td className="mono">{s.take_profit != null ? s.take_profit.toLocaleString("ru-RU", { maximumFractionDigits: 5 }) : "—"}</td>
              <td className="mono">{s.prob_up != null ? `${(s.prob_up * 100).toFixed(1)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── PDF-шаблон для AI-анализа ──────────────────────────────────────────────────
function AnalysisPdfContent({ items, fullData }) {
  return (
    <div>
      <h1>История AI-анализов</h1>
      <p className="meta">{items.length} записей</p>
      {items.map(item => {
        const data = fullData[item.id];
        const v = data?.verdict_block || {};
        const vc = item.verdict?.includes("ПОДТВЕРЖДАЕТ") ? "confirm"
                 : item.verdict?.includes("ПРОТИВОРЕЧИТ") ? "contra" : "neutral";
        return (
          <div key={item.id} className="section">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <strong className="mono" style={{ fontSize: 15 }}>{item.symbol}</strong>
              <span className={`badge ${vc}`}>{verdictLabel(item.verdict)}</span>
              {item.signal_direction && (
                <span className={`badge ${item.signal_direction === "LONG" ? "long" : item.signal_direction === "SHORT" ? "short" : "flat"}`}>
                  {item.signal_direction}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#666" }}>
                {new Date(item.created_at).toLocaleString("ru-RU")}
              </span>
            </div>
            {data ? (
              <>
                {v.verdict_text && <p><strong>Вердикт:</strong> {v.verdict_text}</p>}
                {v.confidence && <p><strong>Уверенность:</strong> {v.confidence}</p>}
                {v.timeframe && <p><strong>Горизонт:</strong> {v.timeframe}</p>}
                {v.summary && <div style={{ marginTop: 8 }}><strong>Резюме:</strong><p>{v.summary}</p></div>}
                {v.key_risks?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Ключевые риски:</strong>
                    <ul>{v.key_risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
                {v.catalysts?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Катализаторы:</strong>
                    <ul>{v.catalysts.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  </div>
                )}
              </>
            ) : (
              <p style={{ color: "#999", fontStyle: "italic" }}>Детали не загружены</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Основной компонент ─────────────────────────────────────────────────────────
export default function HistoryPanel({ signals, onDeleteSignal, onSelectSignal, activeSignalId }) {
  const [tab, setTab] = useState("signals");

  // AI-история
  const [aiItems, setAiItems] = useState([]);
  const [aiLoading, setAiLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [fullData, setFullData] = useState({});
  const [loadingId, setLoadingId] = useState(null);

  const signalPdfRef = useRef(null);
  const aiPdfRef = useRef(null);

  useEffect(() => {
    api.listAnalyses()
      .then(d => setAiItems(d.analyses || []))
      .catch(() => setAiItems([]))
      .finally(() => setAiLoading(false));
  }, []);

  async function toggleAi(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (fullData[id]) return;
    setLoadingId(id);
    try {
      const data = await api.getAnalysis(id);
      setFullData(d => ({ ...d, [id]: data }));
    } catch {}
    setLoadingId(null);
  }

  const TABS = [
    { k: "signals", label: `Прогнозы${signals.length ? ` (${signals.length})` : ""}` },
    { k: "ai", label: `AI-анализы${aiItems.length ? ` (${aiItems.length})` : ""}` },
  ];

  return (
    <div className="card" style={{ marginTop: 18 }}>
      {/* Шапка */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: "pointer", border: "none", fontFamily: "var(--body)",
              background: tab === t.k ? "var(--primary)" : "transparent",
              color: tab === t.k ? "#fff" : "var(--muted)",
              transition: "all .15s",
            }}>{t.label}</button>
          ))}
        </div>
        <button
          onClick={() => {
            if (tab === "signals") exportPdf(signalPdfRef, "История прогнозов");
            else exportPdf(aiPdfRef, "История AI-анализов");
          }}
          style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: "1px solid var(--line)",
            background: "transparent", color: "var(--muted)", fontFamily: "var(--body)",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          ⬇ PDF
        </button>
      </div>

      {/* Вкладка Прогнозы */}
      {tab === "signals" && (
        <>
          {signals.length === 0 ? (
            <div className="empty">История прогнозов пуста.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ opacity: 0.5, textAlign: "left" }}>
                    {["Дата", "Актив", "ТФ", "Направление", "Вход", "SL", "TP", "P(up)", ""].map(h => (
                      <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {signals.map(s => (
                    <SignalRow key={s.id} s={s}
                      active={activeSignalId === s.id}
                      onSelect={onSelectSignal}
                      onDelete={onDeleteSignal}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Скрытый контент для PDF */}
          <div ref={signalPdfRef} style={{ display: "none" }}>
            <SignalPdfContent signals={signals} />
          </div>
        </>
      )}

      {/* Вкладка AI-анализы */}
      {tab === "ai" && (
        <>
          {aiLoading ? (
            <div className="empty">Загрузка…</div>
          ) : aiItems.length === 0 ? (
            <div className="empty">История анализов пуста.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {aiItems.map(item => {
                const isOpen = openId === item.id;
                const vc = verdictColor(item.verdict);
                return (
                  <div key={item.id} style={{
                    border: `1px solid ${isOpen ? vc : "var(--line)"}`,
                    borderRadius: 10, overflow: "hidden", transition: "border-color .15s",
                  }}>
                    <button onClick={() => toggleAi(item.id)} style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 12,
                      padding: "11px 14px", background: "var(--ink)",
                      border: "none", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ fontWeight: 700, fontFamily: "var(--mono)", fontSize: 14, color: "var(--text)", minWidth: 80 }}>
                        {item.symbol}
                      </span>
                      <span style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 6,
                        background: `${vc}20`, border: `1px solid ${vc}`, color: vc,
                        fontWeight: 600, whiteSpace: "nowrap",
                      }}>
                        {verdictLabel(item.verdict)}
                      </span>
                      {item.signal_direction && (
                        <span style={{ fontSize: 12, color: DIR_COLOR[item.signal_direction] || "var(--muted)", fontWeight: 600 }}>
                          {item.signal_direction}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {new Date(item.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted-2)", marginLeft: 6 }}>
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isOpen && (
                      <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}>
                        {loadingId === item.id
                          ? <div style={{ padding: "20px 0", color: "var(--muted-2)", fontSize: 13 }}>Загрузка…</div>
                          : fullData[item.id]
                            ? (
                              <>
                                <AnalysisResult result={fullData[item.id]} />
                                <div style={{ marginTop: 12, textAlign: "right" }}>
                                  <button onClick={() => {
                                    const ref = { current: document.createElement("div") };
                                    ref.current.innerHTML = `
                                      <h1>AI-анализ: ${item.symbol}</h1>
                                      <p class="meta">${new Date(item.created_at).toLocaleString("ru-RU")}</p>
                                      <hr class="divider"/>
                                    `;
                                    // экспортируем только этот анализ
                                    const tmpRef = { current: (() => {
                                      const d = document.createElement("div");
                                      const header = document.createElement("div");
                                      header.innerHTML = `<h1>AI-анализ: ${item.symbol}</h1><p class="meta">${new Date(item.created_at).toLocaleString("ru-RU")} · ${verdictLabel(item.verdict)}</p><hr style="margin:16px 0;border:none;border-top:1px solid #e5e7eb"/>`;
                                      d.appendChild(header);
                                      return d;
                                    })() };
                                    exportPdf(tmpRef, `AI-анализ ${item.symbol}`);
                                  }}
                                    style={{
                                      padding: "5px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer",
                                      border: "1px solid var(--line)", background: "transparent",
                                      color: "var(--muted)", fontFamily: "var(--body)",
                                    }}
                                  >⬇ PDF этого анализа</button>
                                </div>
                              </>
                            )
                            : <div style={{ padding: "20px 0", color: "var(--short)", fontSize: 13 }}>Не удалось загрузить</div>
                        }
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Скрытый контент для PDF всей истории */}
          <div ref={aiPdfRef} style={{ display: "none" }}>
            <AnalysisPdfContent items={aiItems} fullData={fullData} />
          </div>
        </>
      )}
    </div>
  );
}
