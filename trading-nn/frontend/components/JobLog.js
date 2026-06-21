"use client";

const KIND_LABEL = {
  train: "Обучение",
  train_universal: "Обучение класса",
  backtest: "Walk-forward",
  feature_importance: "Feature Importance",
};

const STATUS_LABEL = {
  queued:      { text: "В очереди",    color: "var(--muted)" },
  running:     { text: "Выполняется",  color: "var(--primary)" },
  cancelling:  { text: "Остановка…",  color: "var(--amber)" },
  done:        { text: "Готово",       color: "var(--long)" },
  cancelled:   { text: "Остановлено", color: "var(--amber)" },
  error:       { text: "Ошибка",       color: "var(--short)" },
};

function TrainingChart({ data }) {
  if (!data || data.length === 0) return null;

  const W = 560, H = 120, pL = 36, pR = 8, pT = 8, pB = 20;
  const iW = W - pL - pR;
  const iH = H - pT - pB;

  const lossVals = data.map(d => d.val_loss).filter(v => v != null);
  const aucVals  = data.map(d => d.val_auc).filter(v => v != null);

  const lossMin = Math.min(...lossVals), lossMax = Math.max(...lossVals);
  const aucMin  = Math.min(...aucVals),  aucMax  = Math.max(...aucVals);

  const total = data[data.length - 1]?.total || data.length;
  const xOf = (ep) => pL + ((ep - 1) / Math.max(total - 1, 1)) * iW;

  const yLoss = (v) => {
    const range = lossMax - lossMin || 1e-6;
    return pT + (1 - (v - lossMin) / range) * iH;
  };
  const yAuc = (v) => {
    const range = aucMax - aucMin || 1e-6;
    return pT + (1 - (v - aucMin) / range) * iH;
  };

  const polyLoss = data
    .filter(d => d.val_loss != null)
    .map(d => `${xOf(d.epoch)},${yLoss(d.val_loss)}`).join(" ");
  const polyAuc = data
    .filter(d => d.val_auc != null)
    .map(d => `${xOf(d.epoch)},${yAuc(d.val_auc)}`).join(" ");

  // лучшая эпоха по val_loss
  const bestLoss = data.reduce((b, d) => (d.val_loss != null && (b == null || d.val_loss < b.val_loss)) ? d : b, null);
  const lastEp   = data[data.length - 1];
  const lr       = lastEp?.lr;

  // Y-засечки (val_loss — левая ось)
  const lossGridVals = [lossMin, (lossMin + lossMax) / 2, lossMax];

  const fmt2 = (v) => v != null ? v.toFixed(4) : "—";

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6, fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted-2)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="var(--short)" strokeWidth="2"/></svg>
          val_loss
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="18" height="3"><line x1="0" y1="1.5" x2="18" y2="1.5" stroke="var(--primary)" strokeWidth="2"/></svg>
          val_auc
        </span>
        {bestLoss && (
          <span style={{ color: "var(--long)" }}>
            лучш. эп. {bestLoss.epoch} · loss={fmt2(bestLoss.val_loss)}
          </span>
        )}
        {lr != null && (
          <span>lr={lr.toExponential(1)}</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", maxWidth: W }}>
        {/* фон */}
        <rect x={pL} y={pT} width={iW} height={iH} fill="var(--ink-2)" rx="3" opacity="0.5" />

        {/* горизонтальные сетки + Y-засечки */}
        {lossGridVals.map((v, i) => {
          const yy = yLoss(v);
          return (
            <g key={i}>
              <line x1={pL} y1={yy} x2={pL + iW} y2={yy}
                    stroke="var(--line)" strokeWidth="0.5" opacity="0.4" />
              <text x={pL - 3} y={yy + 3.5} textAnchor="end"
                    fill="var(--muted-2)" fontSize="8" fontFamily="var(--mono)">
                {v.toFixed(3)}
              </text>
            </g>
          );
        })}

        {/* X-ось: засечки эпох */}
        {Array.from({ length: Math.min(total, 10) }, (_, i) => {
          const ep = Math.round(1 + (i / 9) * (total - 1));
          const xx = xOf(ep);
          return (
            <text key={i} x={xx} y={H - 4} textAnchor="middle"
                  fill="var(--muted-2)" fontSize="8" fontFamily="var(--mono)">
              {ep}
            </text>
          );
        })}

        {/* вертикаль лучшей эпохи */}
        {bestLoss && (
          <line x1={xOf(bestLoss.epoch)} y1={pT} x2={xOf(bestLoss.epoch)} y2={pT + iH}
                stroke="var(--long)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
        )}

        {/* кривая val_loss */}
        {polyLoss && (
          <polyline points={polyLoss} fill="none"
                    stroke="var(--short)" strokeWidth="1.5" opacity="0.85" />
        )}

        {/* кривая val_auc */}
        {polyAuc && (
          <polyline points={polyAuc} fill="none"
                    stroke="var(--primary)" strokeWidth="1.5" opacity="0.85" />
        )}

        {/* точка текущей эпохи */}
        {lastEp?.val_loss != null && (
          <circle cx={xOf(lastEp.epoch)} cy={yLoss(lastEp.val_loss)} r="3"
                  fill="var(--short)" />
        )}
        {lastEp?.val_auc != null && (
          <circle cx={xOf(lastEp.epoch)} cy={yAuc(lastEp.val_auc)} r="3"
                  fill="var(--primary)" />
        )}
      </svg>
    </div>
  );
}

export default function JobLog({ job }) {
  if (!job) return null;
  const pct = Math.round((job.progress || 0) * 100);
  const isActive = job.status === "running" || job.status === "queued" || job.status === "cancelling";
  const st = STATUS_LABEL[job.status] || { text: job.status, color: "var(--muted)" };

  const lineClass = (l) => {
    if (/ОШИБКА|ERROR/.test(l)) return "err";
    if (/Готово|остановлен/i.test(l)) return "ok";
    return "";
  };

  const showChart = (job.kind === "train" || job.kind === "train_universal") && job.epoch_data?.length > 0;

  // Для train_universal — парсим статусы инструментов из логов
  const symbolStatuses = (() => {
    if (job.kind !== "train_universal") return null;
    const map = {};
    for (const line of job.logs || []) {
      const load  = line.match(/\[universal\] Загрузка (\S+)/);
      const skip  = line.match(/\[universal\] (\S+) пропущен[:\s]*(.*)/);
      const mismatch = line.match(/\[universal\] (\S+) — несовпадение фич/);
      // успешная загрузка: "[universal] BTCUSDT: train=... val=..."
      const ok    = line.match(/\[universal\] (\S+?):\s+train=/);
      if (load)     map[load[1]] = { status: "loading" };
      if (skip)     map[skip[1]] = { status: "skip", msg: skip[2]?.slice(0, 60) || "" };
      if (mismatch) map[mismatch[1]] = { status: "skip", msg: "несовпадение фич" };
      if (ok)       map[ok[1]] = { status: "ok" };
    }
    // Финальный статус из первой строки лога — список инструментов
    const symbolsLine = (job.logs || []).find(l => l.includes("Универсальное обучение"));
    const paramsLine  = (job.params?.symbols || []);
    const syms = paramsLine.length > 0 ? paramsLine : Object.keys(map);
    if (syms.length === 0) return null;
    return syms.map(s => ({ symbol: s, ...(map[s] || { status: "pending" }) }));
  })();

  return (
    <div className="joblog">
      <div className="joblog-head">
        <span className="name">
          {KIND_LABEL[job.kind] || job.kind} · {job.id}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          {isActive && <span className="spinner" />}
          <span style={{ color: st.color, fontWeight: 600 }}>{st.text}</span>
          <span style={{ color: "var(--muted)" }}>· {pct}%</span>
        </span>
      </div>
      <div className="progress">
        <i style={{
          width: `${pct}%`,
          background: job.status === "cancelled" ? "var(--amber)"
                    : job.status === "error"     ? "var(--short)"
                    : "var(--primary)",
        }} />
      </div>

      {/* Статусы инструментов для train_universal */}
      {symbolStatuses && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0 6px" }}>
          {symbolStatuses.map(({ symbol, status, msg }) => {
            const color = status === "ok"      ? "var(--long)"
                        : status === "skip"    ? "var(--short)"
                        : status === "loading" ? "var(--primary)"
                        :                       "var(--muted-2)";
            const icon  = status === "ok"      ? "✓"
                        : status === "skip"    ? "✕"
                        : status === "loading" ? "…"
                        :                       "·";
            return (
              <span key={symbol} title={msg || symbol}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  fontSize: 11, fontFamily: "var(--mono)", padding: "2px 7px",
                  borderRadius: 4, border: `1px solid ${color}`,
                  color, background: `color-mix(in srgb, ${color} 10%, transparent)`,
                }}>
                <span>{icon}</span>
                <span>{symbol}</span>
              </span>
            );
          })}
        </div>
      )}

      {showChart && <TrainingChart data={job.epoch_data} />}

      <div className="log-lines">
        {(job.logs || []).slice(-40).map((l, i) => (
          <div key={i} className={lineClass(l)}>{l}</div>
        ))}
        {job.error ? <div className="err">{job.error}</div> : null}
      </div>
    </div>
  );
}
