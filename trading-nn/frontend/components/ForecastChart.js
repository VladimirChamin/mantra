"use client";
import { useRef } from "react";

const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
    : "—";

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

function saveAsJpeg(svgEl, wrapEl, filename) {
  // Читаем реальные цвета из DOM перед сериализацией
  const bg      = resolveCssVar("--panel",   "#ffffff");
  const bgPage  = resolveCssVar("--ink",     "#f4f6fb");
  const colLong = resolveCssVar("--long",    "#16a34a");
  const colShort= resolveCssVar("--short",   "#dc2626");
  const colMuted= resolveCssVar("--muted-2", "#9aa3ba");
  const colLine = resolveCssVar("--line",    "#dde3ef");
  const colText = resolveCssVar("--text",    "#0f1828");

  // Клонируем SVG и вставляем разрешённые цвета как атрибуты
  const clone = svgEl.cloneNode(true);
  clone.querySelectorAll("[stroke]").forEach(el => {
    const s = el.getAttribute("stroke");
    if (s === "var(--long)")    el.setAttribute("stroke", colLong);
    if (s === "var(--short)")   el.setAttribute("stroke", colShort);
    if (s === "var(--muted-2)") el.setAttribute("stroke", colMuted);
    if (s === "var(--border)")  el.setAttribute("stroke", colLine);
    if (s === "var(--line)")    el.setAttribute("stroke", colLine);
    if (s === "var(--text)")    el.setAttribute("stroke", colText);
  });
  clone.querySelectorAll("[fill]").forEach(el => {
    const f = el.getAttribute("fill");
    if (f === "var(--long)")    el.setAttribute("fill", colLong);
    if (f === "var(--short)")   el.setAttribute("fill", colShort);
    if (f === "var(--muted-2)") el.setAttribute("fill", colMuted);
    if (f === "var(--border)")  el.setAttribute("fill", colLine);
    if (f === "var(--line)")    el.setAttribute("fill", colLine);
    if (f === "var(--text)")    el.setAttribute("fill", colText);
    if (f === "var(--primary)") el.setAttribute("fill", resolveCssVar("--primary", "#3b6ff0"));
  });
  clone.querySelectorAll("text").forEach(el => {
    const f = el.getAttribute("fill");
    if (f === "var(--muted-2)") el.setAttribute("fill", colMuted);
    if (f === "var(--long)")    el.setAttribute("fill", colLong);
    if (f === "var(--short)")   el.setAttribute("fill", colShort);
    if (f === "var(--text)")    el.setAttribute("fill", colText);
  });
  // фон SVG
  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", "100%");
  bgRect.setAttribute("height", "100%");
  bgRect.setAttribute("fill", bg);
  clone.insertBefore(bgRect, clone.firstChild);

  const svgData = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const W = svgEl.viewBox.baseVal.width  || 800;
    const H = svgEl.viewBox.baseVal.height || 360;
    const S = 2; // retina scale
    const canvas = document.createElement("canvas");
    canvas.width  = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext("2d");
    ctx.scale(S, S);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = filename;
    a.href = canvas.toDataURL("image/jpeg", 0.93);
    a.click();
  };
  img.src = url;
}

export default function ForecastChart({ data, isAdmin }) {
  const svgRef  = useRef(null);
  const wrapRef = useRef(null);

  if (!data || !data.history?.length || !data.forecast?.length) {
    return <div className="empty">Прогноз появится после запроса к обученной модели.</div>;
  }

  const { history, forecast, levels, last_price } = data;
  const hN = history.length;
  const fN = forecast.length;
  const nowIdx = hN - 1;
  const totalBars = hN + fN;

  const dir = (levels?.direction || "FLAT").toLowerCase();
  const accentColor = dir === "long" ? "var(--long)" : dir === "short" ? "var(--short)" : "var(--muted-2)";
  const hasTrade = dir === "long" || dir === "short";

  const forecastHasOHLC = forecast[0]?.open !== undefined;

  // диапазон Y
  const vals = [
    ...history.map((c) => c.high),
    ...history.map((c) => c.low),
    ...forecast.map((p) => forecastHasOHLC ? p.high : p.upper ?? p.mid),
    ...forecast.map((p) => forecastHasOHLC ? p.low  : p.lower ?? p.mid),
  ];
  if (hasTrade) vals.push(levels.entry, levels.stop_loss, levels.take_profit);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
  lo -= pad; hi += pad;

  const W = 800, H = 340, padL = 8, padR = 88, padT = 16, padB = 16;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const barW   = innerW / totalBars;
  const candleW = Math.max(barW * 0.6, 1.5);

  const xBar = (i) => padL + (i + 0.5) * barW;
  const y    = (v) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  // Y-сетка
  const gridLines = Array.from({ length: 6 }, (_, i) => {
    const v = lo + (hi - lo) * (i / 5);
    return { v, yy: y(v) };
  });

  // свечи истории
  const candles = history.map((bar, i) => {
    const cx = xBar(i);
    const isUp = bar.close >= bar.open;
    const bodyTop = y(Math.max(bar.open, bar.close));
    const bodyH   = Math.max(y(Math.min(bar.open, bar.close)) - bodyTop, 1);
    return { cx, bodyTop, bodyH, highY: y(bar.high), lowY: y(bar.low), isUp };
  });

  // прогнозные свечи
  const forecastCandles = forecast.map((bar, i) => {
    const cx = xBar(hN + i);
    if (forecastHasOHLC) {
      const isUp    = bar.close >= bar.open;
      const bodyTop = y(Math.max(bar.open, bar.close));
      const bodyH   = Math.max(y(Math.min(bar.open, bar.close)) - bodyTop, 1);
      return { cx, bodyTop, bodyH, highY: y(bar.high), lowY: y(bar.low), isUp };
    }
    return { cx, midY: y(bar.mid), isUp: true };
  });

  const nowX = xBar(nowIdx);

  const levelLines = hasTrade
    ? [
        { k: "Вход", v: levels.entry,       c: "var(--text)"  },
        { k: "Стоп", v: levels.stop_loss,   c: "var(--short)" },
        { k: "Тейк", v: levels.take_profit, c: "var(--long)"  },
      ]
    : [];

  const filename = `${data.symbol}_${data.interval}_forecast.jpg`;

  return (
    <div ref={wrapRef} className="chart-wrap">
      <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
          {data.symbol} · {data.interval} · {fmt(last_price)}
        </span>
        {isAdmin && (
          <button
            onClick={() => svgRef.current && saveAsJpeg(svgRef.current, wrapRef.current, filename)}
            title="Сохранить в JPEG"
            style={{
              background: "none", border: "1px solid var(--line)", borderRadius: 6,
              color: "var(--muted-2)", cursor: "pointer", padding: "2px 9px",
              fontSize: 11, fontFamily: "var(--mono)", lineHeight: 1.5,
              transition: "border-color .15s, color .15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.color = "var(--primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--line)";    e.currentTarget.style.color = "var(--muted-2)"; }}
          >↓ jpg</button>
        )}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: "block", width: "100%" }}>
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
                  fontSize="9" fontFamily="var(--mono)">{fmt(g.v)}</text>
          </g>
        ))}

        <g clipPath="url(#plot-fc)">
          {/* фон зоны прогноза */}
          <rect x={xBar(nowIdx + 0.5)} y={padT}
                width={padL + innerW - xBar(nowIdx + 0.5)} height={innerH}
                fill={accentColor} opacity="0.04" />

          {/* исторические свечи */}
          {candles.map((c, i) => (
            <g key={i}>
              <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.lowY}
                    stroke={c.isUp ? "var(--long)" : "var(--short)"} strokeWidth="1" />
              <rect x={c.cx - candleW / 2} y={c.bodyTop}
                    width={candleW} height={c.bodyH}
                    fill={c.isUp ? "var(--long)" : "var(--short)"} opacity="0.85" />
            </g>
          ))}

          {/* прогнозные свечи */}
          {forecastHasOHLC
            ? forecastCandles.map((c, i) => (
                <g key={i}>
                  <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.lowY}
                        stroke={c.isUp ? "var(--long)" : "var(--short)"}
                        strokeWidth="1" opacity="0.55" />
                  <rect x={c.cx - candleW / 2} y={c.bodyTop}
                        width={candleW} height={c.bodyH}
                        fill={c.isUp ? "var(--long)" : "var(--short)"}
                        opacity="0.28" />
                  <rect x={c.cx - candleW / 2} y={c.bodyTop}
                        width={candleW} height={c.bodyH}
                        fill="none"
                        stroke={c.isUp ? "var(--long)" : "var(--short)"}
                        strokeWidth="0.7" opacity="0.6" />
                </g>
              ))
            : forecast.map((p, i) => (
                <circle key={i} cx={xBar(hN + i)} cy={y(p.mid)} r="2"
                        fill={accentColor} opacity="0.7" />
              ))
          }

          {/* уровни сделки */}
          {levelLines.map((l, i) => (
            <line key={i} x1={nowX} y1={y(l.v)} x2={padL + innerW} y2={y(l.v)}
                  stroke={l.c} strokeWidth="0.9" strokeDasharray="3 5" opacity="0.85" />
          ))}
        </g>

        {/* вертикаль «сейчас» */}
        <line x1={nowX} y1={padT} x2={nowX} y2={padT + innerH}
              stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />

        {/* подписи уровней справа */}
        {levelLines.map((l, i) => (
          <text key={i} x={padL + innerW + 4} y={y(l.v) + 3.5} fill={l.c}
                fontSize="9" fontFamily="var(--mono)">{l.k} {fmt(l.v)}</text>
        ))}
      </svg>
    </div>
  );
}
