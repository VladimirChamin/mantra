"use client";
import { useRef, useState, useCallback } from "react";

const fmtN = (n, digits = 2) =>
  typeof n === "number"
    ? n.toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })
    : "—";

const fmtPct = (n) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—");

// Резолвит CSS-переменную в hex/rgb через временный элемент
function resolveCssVar(varName, fallback) {
  if (typeof document === "undefined") return fallback;
  const el = document.createElement("div");
  el.style.color = `var(${varName})`;
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  const val = getComputedStyle(el).color;
  document.body.removeChild(el);
  return val || fallback;
}

function saveAsJpeg(svgEl, filename) {
  const bg       = resolveCssVar("--panel",   "#ffffff");
  const colLong  = resolveCssVar("--long",    "#16a34a");
  const colShort = resolveCssVar("--short",   "#dc2626");
  const colMuted = resolveCssVar("--muted-2", "#9aa3ba");
  const colLine  = resolveCssVar("--line",    "#dde3ef");
  const colText  = resolveCssVar("--text",    "#0f1828");
  const clone = svgEl.cloneNode(true);
  const replaceAttr = (attr, map) =>
    clone.querySelectorAll(`[${attr}]`).forEach(el => {
      const v = el.getAttribute(attr);
      if (map[v]) el.setAttribute(attr, map[v]);
    });
  const cmap = {
    "var(--long)": colLong, "var(--short)": colShort, "var(--muted-2)": colMuted,
    "var(--border)": colLine, "var(--line)": colLine, "var(--text)": colText,
    "var(--primary)": resolveCssVar("--primary", "#3b6ff0"),
  };
  replaceAttr("stroke", cmap); replaceAttr("fill", cmap);
  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", "100%"); bgRect.setAttribute("height", "100%"); bgRect.setAttribute("fill", bg);
  clone.insertBefore(bgRect, clone.firstChild);
  const svgData = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([svgData], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const W = svgEl.viewBox.baseVal.width || 800, Hh = svgEl.viewBox.baseVal.height || 340, S = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * S; canvas.height = Hh * S;
    const ctx = canvas.getContext("2d");
    ctx.scale(S, S); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, Hh); ctx.drawImage(img, 0, 0, W, Hh);
    URL.revokeObjectURL(url);
    const a = document.createElement("a"); a.download = filename;
    a.href = canvas.toDataURL("image/jpeg", 0.93); a.click();
  };
  img.src = url;
}

// Определяет статус прогноза по последней прогнозной свече
function resolveStatus(fc, levels) {
  if (!fc || !levels || !levels.direction || levels.direction === "FLAT") return null;
  const lastClose = fc[fc.length - 1]?.close ?? fc[fc.length - 1]?.mid;
  if (lastClose == null) return null;
  const { direction, entry, stop_loss, take_profit } = levels;
  if (direction === "LONG") {
    if (lastClose >= take_profit) return "tp";
    if (lastClose <= stop_loss)  return "sl";
  } else {
    if (lastClose <= take_profit) return "tp";
    if (lastClose >= stop_loss)   return "sl";
  }
  return "open";
}

export default function ForecastChart({ data, isAdmin, actuals }) {
  const svgRef    = useRef(null);
  const [showPivots, setShowPivots] = useState(true);
  const [hover, setHover]           = useState(null); // { i, x, y, bar, isForecast }

  if (!data || !data.history?.length || !data.forecast?.length) {
    return <div className="empty">Прогноз появится после запроса к обученной модели.</div>;
  }

  const { history, forecast, levels, last_price, pivot_levels, symbol, interval, oos_auc, signal } = data;
  const hN = history.length;
  const fN = forecast.length;
  const nowIdx = hN - 1;
  const totalBars = hN + fN;

  const dir = (levels?.direction || "FLAT").toLowerCase();
  const accentColor = dir === "long" ? "var(--long)" : dir === "short" ? "var(--short)" : "var(--muted-2)";
  const hasTrade    = dir === "long" || dir === "short";
  const dirLabel    = { long: "Лонг", short: "Шорт", flat: "Нет входа" }[dir] || "—";
  const forecastHasOHLC = forecast[0]?.open !== undefined;

  const status = resolveStatus(forecast, levels);
  const statusLabel = { tp: "ТП Достигнут", sl: "СЛ Достигнут", open: "Активен", null: "" }[status] ?? "";
  const statusColor = status === "tp" ? "var(--long)" : status === "sl" ? "var(--short)" : "var(--muted-2)";

  const pl = pivot_levels;
  const pivotLines = pl ? [
    { k: "R3", v: pl.r3, c: "#ef4444", dash: "2 4" },
    { k: "R2", v: pl.r2, c: "#f97316", dash: "2 4" },
    { k: "R1", v: pl.r1, c: "#eab308", dash: "2 4" },
    { k: "PP", v: pl.pp, c: "#6366f1", dash: "4 3" },
    { k: "S1", v: pl.s1, c: "#22c55e", dash: "2 4" },
    { k: "S2", v: pl.s2, c: "#14b8a6", dash: "2 4" },
    { k: "S3", v: pl.s3, c: "#3b82f6", dash: "2 4" },
  ] : [];

  // actuals — реальные бары за период прогноза (могут прийти снаружи)
  const actualBars = actuals || data.actuals || [];

  const vals = [
    ...history.map(c => c.high), ...history.map(c => c.low),
    ...forecast.map(p => forecastHasOHLC ? p.high : (p.upper ?? p.mid)),
    ...forecast.map(p => forecastHasOHLC ? p.low  : (p.lower ?? p.mid)),
    ...(showPivots ? pivotLines.map(l => l.v) : []),
    ...actualBars.map(b => b.high),
    ...actualBars.map(b => b.low),
  ];
  if (hasTrade) vals.push(levels.entry, levels.stop_loss, levels.take_profit);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
  lo -= pad; hi += pad;

  const W = 800, H = 320, padL = 8, padR = 88, padT = 18, padB = 14;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barW   = innerW / totalBars;
  const candleW = Math.max(barW * 0.62, 1.5);
  const xBar = (i) => padL + (i + 0.5) * barW;
  const yv   = (v) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  const gridLines = Array.from({ length: 6 }, (_, i) => {
    const v = lo + (hi - lo) * (i / 5);
    return { v, yy: yv(v) };
  });

  const candles = history.map((bar, i) => {
    const cx = xBar(i);
    const isUp = bar.close >= bar.open;
    const bodyTop = yv(Math.max(bar.open, bar.close));
    const bodyH   = Math.max(yv(Math.min(bar.open, bar.close)) - bodyTop, 1);
    return { cx, bodyTop, bodyH, highY: yv(bar.high), lowY: yv(bar.low), isUp, bar };
  });

  const forecastCandles = forecast.map((bar, i) => {
    const cx = xBar(hN + i);
    if (forecastHasOHLC) {
      const isUp    = bar.close >= bar.open;
      const bodyTop = yv(Math.max(bar.open, bar.close));
      const bodyH   = Math.max(yv(Math.min(bar.open, bar.close)) - bodyTop, 1.5);
      return { cx, bodyTop, bodyH, highY: yv(bar.high), lowY: yv(bar.low), isUp, bar };
    }
    return { cx, midY: yv(bar.mid), isUp: true, bar };
  });

  const nowX = xBar(nowIdx);
  const levelLines = hasTrade ? [
    { k: "Вход", v: levels.entry,       c: "var(--text)"  },
    { k: "Стоп", v: levels.stop_loss,   c: "var(--short)" },
    { k: "Тейк", v: levels.take_profit, c: "var(--long)"  },
  ] : [];

  const filename = `${symbol}_${interval}_forecast.jpg`;

  // ── Hover-обработчик ────────────────────────────────────────────────────────
  function onSvgMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx  = Math.floor((svgX - padL) / barW);
    if (idx < 0 || idx >= totalBars) { setHover(null); return; }
    const isForecast = idx >= hN;
    const bar = isForecast ? forecast[idx - hN] : history[idx];
    if (!bar) { setHover(null); return; }
    const cx = xBar(idx);
    const mainPrice = bar.close ?? bar.mid ?? bar.close;
    setHover({ idx, cx, cy: yv(mainPrice), bar, isForecast });
  }

  // прогнозные цены-пилюли
  const forecastPrices = forecast.map(b => b.close ?? b.mid);
  const firstClose = forecastPrices[0];
  const lastClose  = forecastPrices[forecastPrices.length - 1];

  // risk/reward/prob
  const prob    = levels?.prob_up ?? data.signal?.prob_up;
  const conf    = levels?.confidence ?? data.signal?.confidence;
  const rr      = levels?.risk_reward ?? data.signal?.risk_reward;
  const fwdVol  = data.signal?.exp_vol ?? data.signal?.fwd_vol;
  const riskPct = hasTrade && levels?.entry && levels?.stop_loss
    ? Math.abs(levels.stop_loss - levels.entry) / levels.entry : null;
  const rewPct  = hasTrade && levels?.entry && levels?.take_profit
    ? Math.abs(levels.take_profit - levels.entry) / levels.entry : null;

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ── Левая колонка: граф ───────────────────────────────────── */}
      <div style={{ flex: "1 1 520px", minWidth: 0 }}>
        {/* Заголовок графика */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
            {symbol}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
            {interval}
          </span>
          {actualBars.length > 0 && (
            <span style={{
              fontSize: 11, padding: "2px 9px", borderRadius: 20,
              border: "1.5px solid var(--primary)", color: "var(--primary)",
              background: "color-mix(in srgb, var(--primary) 10%, transparent)",
              fontWeight: 600,
            }}>
              + реальные данные ({actualBars.length} баров)
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {pl && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                              fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted-2)", userSelect: "none" }}>
                <input type="checkbox" checked={showPivots} onChange={e => setShowPivots(e.target.checked)}
                       style={{ accentColor: "var(--primary)", cursor: "pointer" }} />
                Pivot
              </label>
            )}
            {isAdmin && (
              <button onClick={() => svgRef.current && saveAsJpeg(svgRef.current, filename)}
                title="Сохранить в JPEG"
                style={{ background: "none", border: "1px solid var(--line)", borderRadius: 6,
                         color: "var(--muted-2)", cursor: "pointer", padding: "2px 9px",
                         fontSize: 11, fontFamily: "var(--mono)", lineHeight: 1.5 }}>
                ↓ jpg
              </button>
            )}
          </div>
        </div>

        {/* SVG Graph */}
        <div style={{ position: "relative" }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
               style={{ display: "block", width: "100%", cursor: "crosshair" }}
               onMouseMove={onSvgMouseMove} onMouseLeave={() => setHover(null)}>
            <defs>
              <clipPath id="plot-fc">
                <rect x={padL} y={padT} width={innerW} height={innerH} />
              </clipPath>
            </defs>

            {/* Y-сетка */}
            {gridLines.map((g, i) => (
              <g key={i}>
                <line x1={padL} y1={g.yy} x2={padL + innerW} y2={g.yy}
                      stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
                <text x={padL + innerW + 4} y={g.yy + 3.5} fill="var(--muted-2)"
                      fontSize="9" fontFamily="var(--mono)">{fmtN(g.v)}</text>
              </g>
            ))}

            <g clipPath="url(#plot-fc)">
              {/* фон зоны прогноза */}
              <rect x={xBar(nowIdx + 0.5)} y={padT}
                    width={padL + innerW - xBar(nowIdx + 0.5)} height={innerH}
                    fill={accentColor} opacity="0.05" />

              {/* Pivot Points */}
              {showPivots && pivotLines.map(l => (
                <line key={l.k} x1={padL} y1={yv(l.v)} x2={padL + innerW} y2={yv(l.v)}
                      stroke={l.c} strokeWidth={l.k === "PP" ? 1.2 : 0.8}
                      strokeDasharray={l.dash} opacity="0.5" />
              ))}

              {/* Исторические свечи */}
              {candles.map((c, i) => {
                const isHov = hover?.idx === i;
                const col = c.isUp ? "var(--long)" : "var(--short)";
                return (
                  <g key={i} opacity={isHov ? 1 : 0.85}>
                    <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.lowY}
                          stroke={col} strokeWidth="1" />
                    <rect x={c.cx - candleW / 2} y={c.bodyTop}
                          width={candleW} height={c.bodyH}
                          fill={col}
                          stroke={isHov ? "var(--text)" : "none"} strokeWidth="0.8" />
                  </g>
                );
              })}

              {/* Прогнозные свечи */}
              {forecastHasOHLC
                ? forecastCandles.map((c, i) => {
                    const isHov = hover?.idx === hN + i;
                    const col = c.isUp ? "var(--long)" : "var(--short)";
                    return (
                      <g key={i} opacity={isHov ? 0.9 : 0.55}>
                        <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.bodyTop}
                              stroke={col} strokeWidth="1" />
                        <line x1={c.cx} y1={c.bodyTop + c.bodyH} x2={c.cx} y2={c.lowY}
                              stroke={col} strokeWidth="1" />
                        <rect x={c.cx - candleW / 2} y={c.bodyTop}
                              width={candleW} height={c.bodyH}
                              fill={col}
                              stroke={isHov ? "var(--text)" : col} strokeWidth={isHov ? 1 : 0.5} />
                        {/* номер прогнозной свечи */}
                        <text x={c.cx} y={padT - 4} fill="var(--muted-2)"
                              fontSize="7" fontFamily="var(--mono)" textAnchor="middle">
                          {i + 1}
                        </text>
                      </g>
                    );
                  })
                : forecast.map((p, i) => (
                    <circle key={i} cx={xBar(hN + i)} cy={yv(p.mid)} r="2.5"
                            fill={accentColor} opacity="0.7" />
                  ))
              }

              {/* Реальные свечи за период прогноза */}
              {actualBars.map((bar, i) => {
                const cx       = xBar(hN + i);
                const isUp     = bar.close >= bar.open;
                const col      = isUp ? "var(--long)" : "var(--short)";
                const bodyTop  = yv(Math.max(bar.open, bar.close));
                const bodyH    = Math.max(yv(Math.min(bar.open, bar.close)) - bodyTop, 1.5);
                return (
                  <g key={`act-${i}`} opacity="0.92">
                    {/* тень от прогноза — тонкая белая обводка */}
                    <rect x={cx - candleW / 2 - 1} y={bodyTop - 1}
                          width={candleW + 2} height={bodyH + 2}
                          fill="var(--panel)" rx="0.5" opacity="0.55" />
                    <line x1={cx} y1={yv(bar.high)} x2={cx} y2={bodyTop}
                          stroke={col} strokeWidth="1.5" />
                    <line x1={cx} y1={bodyTop + bodyH} x2={cx} y2={yv(bar.low)}
                          stroke={col} strokeWidth="1.5" />
                    <rect x={cx - candleW / 2} y={bodyTop}
                          width={candleW} height={bodyH}
                          fill={col} stroke="var(--panel)" strokeWidth="0.8" />
                  </g>
                );
              })}

              {/* Уровни сделки */}
              {levelLines.map((l, i) => (
                <line key={i} x1={nowX} y1={yv(l.v)} x2={padL + innerW} y2={yv(l.v)}
                      stroke={l.c} strokeWidth="0.9" strokeDasharray="3 5" opacity="0.85" />
              ))}

              {/* Вертикаль hover */}
              {hover && (
                <line x1={hover.cx} y1={padT} x2={hover.cx} y2={padT + innerH}
                      stroke="var(--text)" strokeWidth="0.7" strokeDasharray="2 3" opacity="0.4" />
              )}
            </g>

            {/* Вертикаль «сейчас» */}
            <line x1={nowX} y1={padT} x2={nowX} y2={padT + innerH}
                  stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />

            {/* Подписи уровней справа */}
            {levelLines.map((l, i) => (
              <text key={i} x={padL + innerW + 4} y={yv(l.v) + 3.5} fill={l.c}
                    fontSize="9" fontFamily="var(--mono)">{l.k} {fmtN(l.v)}</text>
            ))}
            {showPivots && pivotLines.map(l => (
              <text key={l.k} x={padL + innerW + 4} y={yv(l.v) + 3.5}
                    fill={l.c} fontSize="8" fontFamily="var(--mono)" opacity="0.8">
                {l.k} {fmtN(l.v)}
              </text>
            ))}

            {/* Hover tooltip внутри SVG */}
            {hover && (() => {
              const b = hover.bar;
              const lines = hover.isForecast
                ? [
                    `O: ${fmtN(b.open ?? b.mid)}`,
                    `H: ${fmtN(b.high ?? b.mid)}`,
                    `L: ${fmtN(b.low ?? b.mid)}`,
                    `C: ${fmtN(b.close ?? b.mid)}`,
                    `Свеча: ${hover.idx - hN + 1}`,
                  ]
                : [
                    b.time ? String(b.time).slice(0, 16).replace("T", " ") : "",
                    `O: ${fmtN(b.open)}  H: ${fmtN(b.high)}`,
                    `L: ${fmtN(b.low)}   C: ${fmtN(b.close)}`,
                  ].filter(Boolean);

              const ttW = 130, ttH = lines.length * 13 + 8;
              let tx = hover.cx + 8;
              if (tx + ttW > W - padR) tx = hover.cx - ttW - 8;
              const ty = padT + 4;

              return (
                <g>
                  <rect x={tx} y={ty} width={ttW} height={ttH} rx="5" ry="5"
                        fill="var(--panel)" stroke="var(--line)" strokeWidth="1" opacity="0.95" />
                  {lines.map((ln, li) => (
                    <text key={li} x={tx + 6} y={ty + 13 + li * 13}
                          fill={hover.isForecast ? accentColor : "var(--text)"}
                          fontSize="9" fontFamily="var(--mono)">{ln}</text>
                  ))}
                </g>
              );
            })()}
          </svg>
        </div>

        {/* OOS AUC */}
        {oos_auc != null && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>OOS AUC:</span>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700,
              color: oos_auc >= 0.56 ? "var(--long)" : oos_auc >= 0.54 ? "#f59e0b" : "var(--short)",
            }}>
              {oos_auc.toFixed(4)}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted-2)" }}>
              {oos_auc >= 0.56 ? "✓ Норма" : oos_auc >= 0.54 ? "⚠ Предупреждение" : "✗ Критично"}
            </span>
          </div>
        )}
      </div>

      {/* ── Правая колонка: сигнал-панель ─────────────────────────── */}
      {hasTrade && (
        <div style={{
          flex: "0 0 200px", display: "flex", flexDirection: "column", gap: 0,
          border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden",
          background: "var(--panel)",
        }}>
          {/* Заголовок */}
          <div style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid var(--line)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--mono)" }}>
              Сигнал
            </span>
            <span style={{
              fontSize: 12, fontWeight: 800, padding: "3px 12px", borderRadius: 20,
              background: dir === "long" ? "rgba(16,185,129,.15)" : "rgba(239,68,68,.15)",
              color: accentColor, border: `1.5px solid ${accentColor}`,
            }}>
              {dir === "long" ? "↑ Лонг" : "↓ Шорт"}
            </span>
          </div>

          {/* Уровни */}
          {[
            { label: "Вход", value: levels.entry, color: "var(--text)" },
            { label: "Тейк-профит", value: levels.take_profit, color: "var(--long)", bg: "rgba(16,185,129,.07)" },
            { label: "Стоп-лосс",   value: levels.stop_loss,   color: "var(--short)", bg: "rgba(239,68,68,.07)" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--line-soft)",
              background: bg || "transparent",
            }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700, color }}>
                {fmtN(value)}
              </div>
            </div>
          ))}

          {/* Вероятность */}
          {prob != null && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line-soft)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Вероятность</span>
                <span style={{
                  fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700,
                  color: prob >= 0.6 ? "var(--long)" : prob >= 0.5 ? "#f59e0b" : "var(--short)",
                }}>
                  {(prob * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: "var(--ink-2)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  width: `${Math.round(prob * 100)}%`,
                  background: prob >= 0.6 ? "var(--long)" : prob >= 0.5 ? "#f59e0b" : "var(--short)",
                }} />
              </div>
            </div>
          )}

          {/* Риск-метрики */}
          <div style={{ padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>Риск-метрики</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {[
                { k: "Риск",    v: riskPct != null ? fmtPct(riskPct) : "—", c: "var(--short)" },
                { k: "Награда", v: rewPct  != null ? fmtPct(rewPct)  : "—", c: "var(--long)"  },
                { k: "R:R",     v: rr      != null ? rr              : "—", c: "var(--text)"  },
                { k: "Волат.",  v: fwdVol  != null ? fmtN(fwdVol, 4) : "—", c: "var(--muted)" },
              ].map(({ k, v }) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: "var(--muted-2)", marginBottom: 2 }}>{k}</div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Обоснование прогноза ──────────────────────────────────── */}
      {signal?.explanation?.length > 0 && (
        <div style={{
          marginTop: 14, width: "100%",
          border: "1px solid var(--line)", borderRadius: 10,
          background: "var(--panel)", overflow: "hidden",
        }}>
          <div style={{
            padding: "9px 14px", borderBottom: "1px solid var(--line-soft)",
            fontSize: 10, fontWeight: 700, color: "var(--muted)",
            letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            Обоснование прогноза
          </div>
          <ul style={{ margin: 0, padding: "10px 14px 10px 28px", display: "flex", flexDirection: "column", gap: 5 }}>
            {signal.explanation.map((reason, i) => (
              <li key={i} style={{ fontSize: 12, color: "var(--muted-2)", lineHeight: 1.5 }}>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
