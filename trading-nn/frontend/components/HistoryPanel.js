"use client";


// ── helpers ───────────────────────────────────────────────────────────────────
function verdictColor(v) {
  if (!v) return "#9ca3af";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "#10b981";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "#ef4444";
  return "#9ca3af";
}
function verdictLabel(v) {
  if (!v) return "—";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "✓ Подтверждает";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "✗ Противоречит";
  return "~ Нейтрально";
}
function verdictCss(v) {
  if (!v) return "neutral";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "confirm";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "contra";
  return "neutral";
}
function fmt(n, digits = 5) {
  if (n == null) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}
function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const DIR_CSS  = { LONG: "long", SHORT: "short", FLAT: "flat" };
const DIR_COLOR = { LONG: "var(--long)", SHORT: "var(--short)", FLAT: "var(--muted)" };

// ── SVG-график прогноза для PDF ───────────────────────────────────────────────
function buildChartSvg(fcData) {
  if (!fcData) return "";
  let history  = [], forecast = [], levels = null, lastPrice = null;
  try {
    const parsed = typeof fcData === "string" ? JSON.parse(fcData) : fcData;
    history   = parsed.history  || [];
    forecast  = parsed.forecast || [];
    levels    = parsed.levels;
    lastPrice = parsed.last_price;
  } catch { return ""; }

  if (!history.length && !forecast.length) return "";

  const W = 560, H = 200, PAD = { t: 14, r: 14, b: 28, l: 52 };
  const IW = W - PAD.l - PAD.r;
  const IH = H - PAD.t - PAD.b;

  const allPrices = [
    ...history.map(p => p.close),
    ...forecast.map(p => [p.mid, p.upper, p.lower]).flat(),
    levels?.entry, levels?.stop_loss, levels?.take_profit, lastPrice,
  ].filter(v => v != null && isFinite(v));

  if (!allPrices.length) return "";

  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const pad    = (rawMax - rawMin) * 0.08 || rawMax * 0.01;
  const yMin   = rawMin - pad, yMax = rawMax + pad;

  const totalBars = history.length + forecast.length;
  const xS = i  => PAD.l + (i / Math.max(totalBars - 1, 1)) * IW;
  const yS = v  => PAD.t + IH - ((v - yMin) / (yMax - yMin)) * IH;

  // история
  const hPts = history.map((p, i) => `${xS(i)},${yS(p.close)}`).join(" ");

  // конус прогноза
  const fStart = history.length;
  const upPts   = forecast.map((p, i) => `${xS(fStart + i)},${yS(p.upper ?? p.mid)}`).join(" ");
  const downPts = [...forecast].reverse().map((p, i) => `${xS(fStart + forecast.length - 1 - i)},${yS(p.lower ?? p.mid)}`).join(" ");
  const midPts  = forecast.map((p, i) => `${xS(fStart + i)},${yS(p.mid)}`).join(" ");

  // y-labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = yMin + (yMax - yMin) * (i / yTicks);
    const y = yS(v);
    const label = v >= 1000 ? v.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : v.toPrecision(5);
    return `<text x="${PAD.l - 4}" y="${y + 4}" text-anchor="end" font-size="8" fill="#9ca3af">${label}</text>
            <line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#f3f4f6" stroke-width="0.5"/>`;
  }).join("");

  // горизонтальная разделительная линия история/прогноз
  const splitX = xS(fStart);

  // уровни
  let levelLines = "";
  if (levels) {
    const lvls = [
      { v: levels.entry,       color: "#6366f1", label: "Entry" },
      { v: levels.stop_loss,   color: "#ef4444", label: "SL" },
      { v: levels.take_profit, color: "#10b981", label: "TP" },
    ];
    lvls.forEach(({ v, color, label }) => {
      if (v == null) return;
      const y = yS(v);
      levelLines += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="${color}" stroke-width="0.8" stroke-dasharray="4,3"/>
                     <text x="${W - PAD.r + 2}" y="${y + 4}" font-size="7" fill="${color}" font-weight="bold">${label}</text>`;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block;max-width:100%">
  ${yLabels}
  <!-- история -->
  ${history.length > 1 ? `<polyline points="${hPts}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round"/>` : ""}
  <!-- разделитель -->
  <line x1="${splitX}" y1="${PAD.t}" x2="${splitX}" y2="${H - PAD.b}" stroke="#d1d5db" stroke-width="0.8" stroke-dasharray="3,3"/>
  <!-- конус -->
  ${forecast.length > 1 ? `<polygon points="${upPts} ${downPts}" fill="#10b981" fill-opacity="0.12"/>
  <polyline points="${midPts}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="4,2"/>` : ""}
  <!-- уровни -->
  ${levelLines}
  <!-- ось X -->
  <line x1="${PAD.l}" y1="${H - PAD.b}" x2="${W - PAD.r}" y2="${H - PAD.b}" stroke="#e5e7eb" stroke-width="0.8"/>
</svg>`;
}

// ── CSS для PDF-окна ──────────────────────────────────────────────────────────
const PDF_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.55;
         color: #111827; background: #fff; padding: 36px 44px; }
  h1   { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 4px; }
  h2   { font-size: 14px; font-weight: 700; color: #1f2937; margin: 20px 0 8px;
         padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  h3   { font-size: 12px; font-weight: 700; color: #374151; margin: 12px 0 6px; }
  .meta { font-size: 11px; color: #6b7280; margin-bottom: 6px; }
  .sep  { border: none; border-top: 1px solid #e5e7eb; margin: 28px 0; }

  .badge { display:inline-block; padding:2px 9px; border-radius:5px;
           font-size:11px; font-weight:700; border:1px solid; }
  .long    { background:#d1fae5; color:#065f46; border-color:#6ee7b7; }
  .short   { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
  .flat    { background:#f3f4f6; color:#6b7280; border-color:#d1d5db; }
  .confirm { background:#d1fae5; color:#065f46; border-color:#6ee7b7; }
  .contra  { background:#fee2e2; color:#991b1b; border-color:#fca5a5; }
  .neutral { background:#f3f4f6; color:#6b7280; border-color:#d1d5db; }

  .kv-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:12px 0; }
  .kv { background:#f9fafb; border:1px solid #e5e7eb; border-radius:7px; padding:10px 12px; }
  .kv .label { font-size:10px; color:#9ca3af; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px; }
  .kv .val   { font-size:14px; font-weight:700; color:#111; font-family:monospace; }
  .kv .val.up   { color:#065f46; }
  .kv .val.down { color:#991b1b; }

  .chart-box { border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;
               margin:12px 0; padding:12px 8px; background:#fafafa; }

  .verdict-box { display:flex; align-items:center; gap:14px;
                 padding:14px 18px; border-radius:10px; margin:12px 0;
                 border-width:2px; border-style:solid; }
  .verdict-box.confirm { border-color:#10b981; background:#ecfdf5; }
  .verdict-box.contra  { border-color:#ef4444; background:#fef2f2; }
  .verdict-box.neutral { border-color:#9ca3af; background:#f9fafb; }
  .verdict-text { font-size:17px; font-weight:700; }
  .verdict-text.confirm { color:#065f46; }
  .verdict-text.contra  { color:#991b1b; }
  .verdict-text.neutral { color:#6b7280; }
  .verdict-sub { font-size:11px; color:#6b7280; margin-top:3px; }

  .section { border:1px solid #e5e7eb; border-radius:8px; padding:12px 16px; margin:10px 0; }
  .section-title { font-size:10px; font-weight:700; text-transform:uppercase;
                   letter-spacing:.08em; color:#9ca3af; margin-bottom:8px; }
  .two-col { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:10px 0; }
  ul { padding-left:18px; margin:6px 0; }
  li { margin-bottom:3px; font-size:12px; }
  p  { margin:6px 0; font-size:12px; line-height:1.6; }

  table { width:100%; border-collapse:collapse; margin:10px 0; }
  th,td { padding:7px 10px; text-align:left; border-bottom:1px solid #e5e7eb; font-size:12px; }
  th { font-weight:600; background:#f9fafb; }

  .footer { margin-top:36px; padding-top:10px; border-top:1px solid #e5e7eb;
            font-size:10px; color:#9ca3af; }
  @media print { body { padding:18px 22px; } }
`;

// ── генерация HTML сигнала (один прогноз) ────────────────────────────────────
function buildSignalHtml(signal, analysisData) {
  const dir    = signal.direction || "FLAT";
  const dirCss = DIR_CSS[dir] || "flat";

  let fcData = null;
  try { fcData = signal.forecast_json ? JSON.parse(signal.forecast_json) : null; } catch {}

  const chartSvg = buildChartSvg(fcData);

  const kv = (label, val, cls = "") =>
    `<div class="kv"><div class="label">${label}</div><div class="val ${cls}">${val}</div></div>`;

  const kvHtml = `
    <div class="kv-grid">
      ${kv("Направление", `<span class="badge ${dirCss}">${dir}</span>`)}
      ${kv("P(up)", signal.prob_up != null ? `${(signal.prob_up * 100).toFixed(1)}%` : "—", signal.prob_up >= 0.6 ? "up" : signal.prob_up < 0.5 ? "down" : "")}
      ${kv("Уверенность", signal.confidence != null ? `${(signal.confidence * 100).toFixed(0)}%` : "—")}
      ${kv("R/R", signal.risk_reward != null ? signal.risk_reward.toFixed(2) : "—")}
      ${kv("Вход", fmt(signal.entry))}
      ${kv("Stop Loss", fmt(signal.stop_loss), "down")}
      ${kv("Take Profit", fmt(signal.take_profit), "up")}
      ${kv("Ожид. доходность", signal.exp_return != null ? `${(signal.exp_return * 100).toFixed(2)}%` : "—")}
    </div>`;

  // AI-анализ
  let aiHtml = "";
  if (analysisData) {
    const v   = analysisData.verdict || {};
    const vc  = verdictCss(v.verdict);
    const col = verdictColor(v.verdict);

    aiHtml += `<h2>AI-аналитика</h2>
    <div class="verdict-box ${vc}">
      <div>
        <div class="verdict-text ${vc}">${v.verdict || "—"}</div>
        <div class="verdict-sub">Фундаментальный анализ ${vc === "confirm" ? "согласен с" : vc === "contra" ? "противоречит" : "нейтрален к"} сигналом нейросети</div>
      </div>
    </div>`;

    if (v.recommendation)
      aiHtml += `<div class="section"><div class="section-title">Вывод</div><p>${v.recommendation}</p></div>`;

    if (v.news_summary)
      aiHtml += `<div class="section"><div class="section-title">Новостной фон</div><p>${v.news_summary}</p></div>`;

    if (v.cot_summary)
      aiHtml += `<div class="section"><div class="section-title">COT-позиции</div><p>${v.cot_summary}</p></div>`;

    if (v.macro_summary)
      aiHtml += `<div class="section"><div class="section-title">Макро / Сентимент</div><p>${v.macro_summary}</p></div>`;

    if (v.key_risks?.length || v.key_catalysts?.length) {
      aiHtml += `<div class="two-col">`;
      if (v.key_risks?.length)
        aiHtml += `<div><h3>Ключевые риски</h3><ul>${v.key_risks.map(r => `<li>${r}</li>`).join("")}</ul></div>`;
      if (v.key_catalysts?.length)
        aiHtml += `<div><h3>Катализаторы</h3><ul>${v.key_catalysts.map(c => `<li>${c}</li>`).join("")}</ul></div>`;
      aiHtml += `</div>`;
    }

    if (v.trade_plan)
      aiHtml += `<div class="section"><div class="section-title">Торговый план</div><p>${v.trade_plan}</p></div>`;
  }

  return `
    <h1>${signal.symbol || "—"} · ${signal.interval || ""}</h1>
    <div class="meta">${fmtDate(signal.created_at)}</div>
    ${kvHtml}
    ${chartSvg ? `<div class="chart-box">${chartSvg}</div>` : ""}
    ${aiHtml}
  `;
}

// ── генерация HTML истории прогнозов (таблица) ────────────────────────────────
function buildSignalsListHtml(signals) {
  const rows = signals.map(s => {
    const dir = s.direction || "FLAT";
    return `<tr>
      <td>${fmtDate(s.created_at)}</td>
      <td style="font-weight:700;font-family:monospace">${s.symbol || "—"}</td>
      <td style="font-family:monospace">${s.interval || "—"}</td>
      <td><span class="badge ${DIR_CSS[dir] || "flat"}">${dir}</span></td>
      <td style="font-family:monospace">${fmt(s.entry)}</td>
      <td style="font-family:monospace;color:#991b1b">${fmt(s.stop_loss)}</td>
      <td style="font-family:monospace;color:#065f46">${fmt(s.take_profit)}</td>
      <td style="font-family:monospace">${s.prob_up != null ? `${(s.prob_up * 100).toFixed(1)}%` : "—"}</td>
    </tr>`;
  }).join("");

  return `
    <h1>История прогнозов</h1>
    <div class="meta">${signals.length} записей · Mantra Trading NN</div>
    <table>
      <thead><tr>
        <th>Дата</th><th>Актив</th><th>ТФ</th><th>Направление</th>
        <th>Вход</th><th>SL</th><th>TP</th><th>P(up)</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── генерация HTML одного AI-анализа (полный) ────────────────────────────────
function buildSingleAiHtml(item, data) {
  const v   = data?.verdict || {};
  const vc  = verdictCss(item.verdict);
  const dirBadge = item.signal_direction
    ? `<span class="badge ${DIR_CSS[item.signal_direction] || "flat"}">${item.signal_direction}</span>` : "";

  let body = `
    <h1>${item.symbol} · AI-анализ</h1>
    <div class="meta">${fmtDate(item.created_at)} ${dirBadge}</div>
    <div class="verdict-box ${vc}">
      <div>
        <div class="verdict-text ${vc}">${item.verdict || "—"}</div>
        <div class="verdict-sub">Фундаментальный анализ ${vc === "confirm" ? "согласен с" : vc === "contra" ? "противоречит" : "нейтрален к"} сигналу нейросети</div>
      </div>
    </div>`;

  if (!data) return body;

  if (v.recommendation)
    body += `<div class="section"><div class="section-title">Вывод</div><p>${v.recommendation}</p></div>`;

  if (v.news_summary) {
    body += `<div class="section"><div class="section-title">Новостной фон</div><p>${v.news_summary}</p>`;
    if (data.news?.length)
      body += `<ul style="margin-top:6px">${data.news.map(n => `<li style="font-size:11px;opacity:.6">${n.title}</li>`).join("")}</ul>`;
    body += `</div>`;
  }

  if (data.cot || v.cot_summary) {
    body += `<div class="section"><div class="section-title">COT позиции (CFTC)${data.cot ? ` · ${data.cot.market}` : ""}</div>`;
    if (data.cot) {
      const cot = data.cot;
      body += `<table><tr><th>Участники</th><th>Long</th><th>Short</th><th>Нетто</th></tr>`;
      [["Commercials", cot.commercial_long, cot.commercial_short],
       ["Large Specs", cot.noncommercial_long, cot.noncommercial_short],
       ["Small Specs", cot.nonreportable_long, cot.nonreportable_short]
      ].forEach(([label, l, s]) => {
        if (l == null) return;
        const net = (l || 0) - (s || 0);
        body += `<tr><td>${label}</td><td style="color:#065f46">${(l/1000).toFixed(0)}k</td><td style="color:#991b1b">${(s/1000).toFixed(0)}k</td><td style="font-weight:700;color:${net>0?"#065f46":"#991b1b"}">${net>0?"+":""}${(net/1000).toFixed(0)}k</td></tr>`;
      });
      body += `</table>`;
    }
    if (v.cot_summary) body += `<p>${v.cot_summary}</p>`;
    body += `</div>`;
  }

  if (data.fear_greed || v.macro_summary) {
    body += `<div class="section"><div class="section-title">Макро / Сентимент</div>`;
    if (data.fear_greed) {
      const fg = data.fear_greed;
      const fgColor = fg.value > 60 ? "#065f46" : fg.value < 40 ? "#991b1b" : "#92400e";
      body += `<p><strong style="color:${fgColor}">Fear &amp; Greed: ${fg.value} — ${fg.label}</strong></p>`;
    }
    if (v.macro_summary) body += `<p>${v.macro_summary}</p>`;
    body += `</div>`;
  }

  if (data.onchain || v.onchain_summary) {
    body += `<div class="section"><div class="section-title">Рыночные данные</div>`;
    if (data.onchain) {
      const oc  = data.onchain;
      const m   = oc.market      || {};
      const der = oc.derivatives || {};
      const ls  = oc.long_short  || {};
      const nf  = oc.netflow     || {};

      function fmtL(n) {
        if (n == null) return null;
        if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
        if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
        if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
        return String(n);
      }

      const rows = [
        m.market_cap_usd       != null && ["Рыночная кап.", fmtL(m.market_cap_usd), ""],
        m.total_volume_24h     != null && ["Объём 24ч",     fmtL(m.total_volume_24h), ""],
        m.price_change_24h_pct != null && ["Изм. 24ч",      `${m.price_change_24h_pct.toFixed(2)}%`, m.price_change_24h_pct >= 0 ? "#065f46" : "#991b1b"],
        m.price_change_7d_pct  != null && ["Изм. 7д",       `${m.price_change_7d_pct.toFixed(2)}%`,  m.price_change_7d_pct  >= 0 ? "#065f46" : "#991b1b"],
        m.ath_change_pct       != null && ["От ATH",        `${m.ath_change_pct.toFixed(1)}%`, "#6b7280"],
        der.open_interest_usd  != null && ["Open Interest", fmtL(der.open_interest_usd), ""],
        der.funding_rate_avg   != null && ["Funding Rate",  `${der.funding_rate_avg > 0 ? "+" : ""}${der.funding_rate_avg}%`, der.funding_rate_avg < 0 ? "#991b1b" : der.funding_rate_avg > 0.02 ? "#065f46" : "#6b7280"],
        ls.long_short_ratio    != null && ["L/S Ratio",     `${ls.long_short_ratio} (L ${ls.long_pct}% / S ${ls.short_pct}%)`, ""],
        nf.active_addresses_24h != null && ["Акт. адресов 24ч", Number(nf.active_addresses_24h).toLocaleString("ru-RU"), ""],
        nf.tx_count_24h        != null && ["Транзакций 24ч", Number(nf.tx_count_24h).toLocaleString("ru-RU"), ""],
        nf.avg_fee_usd         != null && ["Ср. комиссия",  `$${nf.avg_fee_usd}`, ""],
      ].filter(Boolean);

      if (rows.length)
        body += `<div class="kv-grid">${rows.map(([l, val, col]) =>
          `<div class="kv"><div class="label">${l}</div><div class="val" style="${col ? `color:${col}` : ""}">${val}</div></div>`
        ).join("")}</div>`;
    }
    if (v.onchain_summary) body += `<p style="margin-top:8px">${v.onchain_summary}</p>`;
    body += `</div>`;
  }

  if (v.key_risks?.length || v.key_catalysts?.length) {
    body += `<div class="two-col">`;
    if (v.key_risks?.length)
      body += `<div><h3>Ключевые риски</h3><ul>${v.key_risks.map(r => `<li>${r}</li>`).join("")}</ul></div>`;
    if (v.key_catalysts?.length)
      body += `<div><h3>Катализаторы</h3><ul>${v.key_catalysts.map(c => `<li>${c}</li>`).join("")}</ul></div>`;
    body += `</div>`;
  }

  if (v.trade_plan)
    body += `<div class="section"><div class="section-title">Торговый план</div><p>${v.trade_plan}</p></div>`;

  return body;
}

// ── генерация HTML истории AI-анализов (список) ───────────────────────────────
function buildAiListHtml(items, fullData) {
  const blocks = items.map(item => buildSingleAiHtml(item, fullData[item.id])).join('<hr class="sep"/>');
  return `
    <h1>История AI-анализов</h1>
    <div class="meta">${items.length} записей · Mantra Trading NN</div>
    <hr class="sep"/>
    ${blocks}
  `;
}

// ── открываем PDF-окно ────────────────────────────────────────────────────────
function openPdf(bodyHtml, title) {
  const html = `<!DOCTYPE html><html lang="ru"><head>
  <meta charset="utf-8"/><title>${title}</title>
  <style>${PDF_CSS}</style></head>
  <body>
    ${bodyHtml}
    <div class="footer">Сгенерировано ${new Date().toLocaleString("ru-RU")} · Mantra Trading NN</div>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Разрешите всплывающие окна для этого сайта"); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ── Строка прогноза ───────────────────────────────────────────────────────────
function SignalRow({ s, active, onSelect, onDelete }) {
  return (
    <tr
      onClick={() => s.forecast_json && onSelect(s)}
      style={{
        borderBottom: "1px solid var(--line)",
        background: active ? "var(--ink-2)" : "transparent",
        cursor: s.forecast_json ? "pointer" : "default",
        transition: "background .1s",
      }}
      onMouseEnter={e => !active && (e.currentTarget.style.background = "var(--panel-2)")}
      onMouseLeave={e => !active && (e.currentTarget.style.background = "")}
    >
      <td style={{ padding: "7px 10px", color: "var(--muted)", fontSize: 12 }}>{fmtDate(s.created_at)}</td>
      <td style={{ padding: "7px 10px", fontWeight: 700, fontFamily: "var(--mono)" }}>{s.symbol || "—"}</td>
      <td style={{ padding: "7px 10px", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12 }}>{s.interval || "—"}</td>
      <td style={{ padding: "7px 10px", fontWeight: 700, color: DIR_COLOR[s.direction] || "var(--muted)" }}>{s.direction || "—"}</td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>{fmt(s.entry)}</td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--short)" }}>{fmt(s.stop_loss)}</td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--long)" }}>{fmt(s.take_profit)}</td>
      <td style={{ padding: "7px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>
        {s.prob_up != null ? `${(s.prob_up * 100).toFixed(1)}%` : "—"}
      </td>
      <td style={{ padding: "7px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
        <button
          title="PDF"
          onClick={e => { e.stopPropagation(); onSelect(s, true); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13, padding: "2px 5px", borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--primary)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
        >⬇</button>
        <button
          title="Удалить"
          onClick={e => { e.stopPropagation(); onDelete(s.id); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 15, padding: "2px 5px", borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--short)"}
          onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
        >✕</button>
      </td>
    </tr>
  );
}

// ── Основной компонент ────────────────────────────────────────────────────────
export default function HistoryPanel({ signals, onDeleteSignal, onSelectSignal, activeSignalId }) {
  // PDF одного прогноза
  async function exportSignalPdf(signal) {
    openPdf(buildSignalHtml(signal, null), `${signal.symbol} ${signal.interval}`);
  }

  // обработчик клика по строке или кнопке PDF
  function handleSignalClick(signal, pdfMode = false) {
    if (pdfMode) {
      exportSignalPdf(signal);
    } else {
      onSelectSignal(signal);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      {/* Шапка */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
          Прогнозы{signals.length ? ` (${signals.length})` : ""}
        </span>
      </div>

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
                  onSelect={handleSignalClick}
                  onDelete={onDeleteSignal}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
