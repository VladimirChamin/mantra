"use client";

const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
    : "—";

export default function ForecastChart({ data }) {
  if (!data || !data.history?.length || !data.forecast?.length) {
    return <div className="empty">Прогноз появится после запроса к обученной модели.</div>;
  }

  const { history, forecast, levels, last_price } = data;
  const hN = history.length;
  const fN = forecast.length;
  const nowIdx = hN - 1;
  const totalBars = hN + fN;

  const dir = (levels?.direction || "FLAT").toLowerCase();
  const accentColor = dir === "long" ? "var(--long)" : dir === "short" ? "var(--short)" : "var(--muted)";
  const hasTrade = dir === "long" || dir === "short";

  // проверяем есть ли OHLC в прогнозе (новый формат)
  const forecastHasOHLC = forecast[0]?.open !== undefined;

  // диапазон Y — включаем прогнозные high/low если есть
  const vals = [
    ...history.map((c) => c.high),
    ...history.map((c) => c.low),
    ...forecast.map((p) => forecastHasOHLC ? p.high : p.upper ?? p.mid),
    ...forecast.map((p) => forecastHasOHLC ? p.low  : p.lower ?? p.mid),
  ];
  if (hasTrade) vals.push(levels.entry, levels.stop_loss, levels.take_profit);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || hi * 0.02 || 1;
  lo -= pad;
  hi += pad;

  const W = 800, H = 360, padL = 8, padR = 100, padT = 20, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const barW = innerW / totalBars;
  const candleW = Math.max(barW * 0.6, 1.5);

  const xBar = (i) => padL + (i + 0.5) * barW;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * innerH;

  // Y-сетка
  const gridCount = 5;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = lo + (hi - lo) * (i / gridCount);
    return { v, yy: y(v) };
  });

  // свечи истории
  const candles = history.map((bar, i) => {
    const cx = xBar(i);
    const isUp = bar.close >= bar.open;
    const bodyTop = y(Math.max(bar.open, bar.close));
    const bodyBot = y(Math.min(bar.open, bar.close));
    const bodyH = Math.max(bodyBot - bodyTop, 1);
    return { cx, bodyTop, bodyH, highY: y(bar.high), lowY: y(bar.low), isUp };
  });

  // прогнозные свечи
  const forecastCandles = forecast.map((bar, i) => {
    const cx = xBar(hN + i);
    if (forecastHasOHLC) {
      const isUp = bar.close >= bar.open;
      const bodyTop = y(Math.max(bar.open, bar.close));
      const bodyBot = y(Math.min(bar.open, bar.close));
      const bodyH = Math.max(bodyBot - bodyTop, 1);
      return { cx, bodyTop, bodyH, highY: y(bar.high), lowY: y(bar.low), isUp, hasohlc: true };
    }
    // fallback: старый формат — рисуем точку на mid
    const midY = y(bar.mid);
    return { cx, midY, hasohlc: false };
  });

  const nowX = xBar(nowIdx);

  const levelLines = hasTrade
    ? [
        { k: "Вход", v: levels.entry,       c: "var(--text)" },
        { k: "Стоп", v: levels.stop_loss,   c: "var(--short)" },
        { k: "Тейк", v: levels.take_profit, c: "var(--long)" },
      ]
    : [];

  // конусная полоса для fallback (старый формат)
  const conePath = !forecastHasOHLC && forecast.length > 0
    ? [
        ...forecast.map((p, i) => `${i === 0 ? "M" : "L"}${xBar(hN + i)},${y(p.upper ?? p.mid)}`),
        ...forecast.map((p, i) => `L${xBar(hN + forecast.length - 1 - i)},${y(forecast[forecast.length - 1 - i].lower ?? forecast[forecast.length - 1 - i].mid)}`),
        "Z",
      ].join(" ")
    : null;

  return (
    <div className="chart-wrap">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {data.symbol} · {data.interval} · прогноз на {fN} баров · последняя цена {fmt(last_price)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img"
           aria-label="OHLC график с прогнозом">
        <defs>
          <clipPath id="plot-fc">
            <rect x={padL} y={padT} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {/* сетка */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.yy} x2={padL + innerW} y2={g.yy}
                  stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
            <text x={padL + innerW + 4} y={g.yy + 4} fill="var(--muted-2)"
                  fontSize="9" fontFamily="var(--mono)">{fmt(g.v)}</text>
          </g>
        ))}

        <g clipPath="url(#plot-fc)">
          {/* OHLC свечи истории */}
          {candles.map((c, i) => (
            <g key={i}>
              <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.lowY}
                    stroke={c.isUp ? "var(--long)" : "var(--short)"}
                    strokeWidth="1" />
              <rect x={c.cx - candleW / 2} y={c.bodyTop}
                    width={candleW} height={c.bodyH}
                    fill={c.isUp ? "var(--long)" : "var(--short)"}
                    opacity="0.85" />
            </g>
          ))}

          {/* прогнозные свечи (Pivot Point) */}
          {forecastHasOHLC
            ? forecastCandles.map((c, i) => (
                <g key={i}>
                  {/* фитиль */}
                  <line x1={c.cx} y1={c.highY} x2={c.cx} y2={c.lowY}
                        stroke={c.isUp ? "var(--long)" : "var(--short)"}
                        strokeWidth="1" opacity="0.6" />
                  {/* тело полупрозрачное */}
                  <rect x={c.cx - candleW / 2} y={c.bodyTop}
                        width={candleW} height={c.bodyH}
                        fill={c.isUp ? "var(--long)" : "var(--short)"}
                        opacity="0.35" />
                  {/* рамка тела — подчёркивает что это прогноз */}
                  <rect x={c.cx - candleW / 2} y={c.bodyTop}
                        width={candleW} height={c.bodyH}
                        fill="none"
                        stroke={c.isUp ? "var(--long)" : "var(--short)"}
                        strokeWidth="0.8" opacity="0.7" />
                </g>
              ))
            : conePath && (
                <path d={conePath} fill={accentColor} opacity="0.08" />
              )
          }

          {/* уровни сделки */}
          {levelLines.map((l, i) => (
            <line key={i} x1={nowX} y1={y(l.v)} x2={padL + innerW} y2={y(l.v)}
                  stroke={l.c} strokeWidth="1" strokeDasharray="3 5" opacity="0.9" />
          ))}
        </g>

        {/* вертикаль «сейчас» */}
        <line x1={nowX} y1={padT} x2={nowX} y2={padT + innerH}
              stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={nowX + 4} y={padT + 11} fill="var(--muted-2)"
              fontSize="10" fontFamily="var(--mono)">сейчас</text>

        {/* разделитель прогноза */}
        <rect x={nowX} y={padT} width={padL + innerW - nowX} height={innerH}
              fill={accentColor} opacity="0.03" />

        {/* подписи уровней справа */}
        {levelLines.map((l, i) => (
          <text key={i} x={padL + innerW + 4} y={y(l.v) + 4} fill={l.c}
                fontSize="11" fontFamily="var(--mono)">
            {l.k} {fmt(l.v)}
          </text>
        ))}
      </svg>

      {/* легенда прогноза */}
      <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="14" height="10">
            <rect x="1" y="1" width="12" height="8"
                  fill="var(--long)" opacity="0.35"
                  stroke="var(--long)" strokeWidth="0.8" />
          </svg>
          Прогнозная свеча (бычья)
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="14" height="10">
            <rect x="1" y="1" width="12" height="8"
                  fill="var(--short)" opacity="0.35"
                  stroke="var(--short)" strokeWidth="0.8" />
          </svg>
          Прогнозная свеча (медвежья)
        </span>
        <span style={{ color: "var(--muted-2)" }}>· уровни Open/High/Low/Close — Pivot Point</span>
      </div>
    </div>
  );
}
