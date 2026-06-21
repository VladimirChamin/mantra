"use client";

// Визуализация фолдов walk-forward: IS (train) и OOS (test) полосы по временной шкале
export default function WalkForwardChart({ folds, anchored }) {
  if (!folds || folds.length === 0) return null;

  // Парсим даты всех диапазонов
  const allDates = folds.flatMap(f => [
    new Date(f.train_range[0]),
    new Date(f.train_range[1]),
    new Date(f.test_range[0]),
    new Date(f.test_range[1]),
  ]);
  const minT = Math.min(...allDates.map(d => d.getTime()));
  const maxT = Math.max(...allDates.map(d => d.getTime()));
  const span = maxT - minT || 1;

  const W = 620, ROW_H = 22, ROW_GAP = 4, PAD_L = 42, PAD_R = 12, PAD_T = 20, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const H = PAD_T + folds.length * (ROW_H + ROW_GAP) - ROW_GAP + PAD_B;

  const xOf = (dateStr) => PAD_L + ((new Date(dateStr).getTime() - minT) / span) * innerW;

  // Временная шкала: ~6 засечек
  const tickCount = 6;
  const tickDates = Array.from({ length: tickCount }, (_, i) => {
    return new Date(minT + (i / (tickCount - 1)) * span);
  });
  const fmtDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
        Структура фолдов walk-forward
      </div>

      {/* Легенда */}
      <div style={{ display: "flex", gap: 18, marginBottom: 10, fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted-2)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 22, height: 10, background: "rgba(132,204,104,0.75)", border: "1px solid rgba(100,180,70,.6)", borderRadius: 2 }} />
          In-sample (IS) — обучение
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 22, height: 10, background: "rgba(96,165,250,0.65)", border: "1px solid rgba(59,130,246,.5)", borderRadius: 2 }} />
          Out-of-sample (OOS) — тест
        </span>
        {anchored && (
          <span style={{ color: "var(--primary)" }}>· расширяющееся окно</span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", overflow: "visible" }}>
        {/* Вертикальные сетки по временным засечкам */}
        {tickDates.map((d, i) => {
          const xx = PAD_L + (i / (tickCount - 1)) * innerW;
          return (
            <line key={i}
              x1={xx} y1={PAD_T} x2={xx} y2={H - PAD_B}
              stroke="var(--line)" strokeWidth="0.5" opacity="0.5" />
          );
        })}

        {/* Строки фолдов */}
        {folds.map((fold, i) => {
          const y = PAD_T + i * (ROW_H + ROW_GAP);

          const trX1 = xOf(fold.train_range[0]);
          const trX2 = xOf(fold.train_range[1]);
          const teX1 = xOf(fold.test_range[0]);
          const teX2 = xOf(fold.test_range[1]);

          const trW = Math.max(trX2 - trX1, 2);
          const teW = Math.max(teX2 - teX1, 2);

          // цвет строки по метрике фолда
          const ret  = fold.total_return ?? 0;
          const labelColor = ret > 0 ? "var(--long)" : ret < 0 ? "var(--short)" : "var(--muted)";
          const retStr = ret !== 0 ? `${ret > 0 ? "+" : ""}${(ret * 100).toFixed(1)}%` : "";

          return (
            <g key={i}>
              {/* Номер фолда слева */}
              <text x={PAD_L - 5} y={y + ROW_H / 2 + 4}
                textAnchor="end" fill="var(--muted-2)"
                fontSize="9" fontFamily="var(--mono)">
                {fold.fold}
              </text>

              {/* IS полоса */}
              <rect x={trX1} y={y} width={trW} height={ROW_H}
                fill="rgba(132,204,104,0.75)" stroke="rgba(100,180,70,.6)" strokeWidth="0.5" rx="2" />

              {/* OOS полоса */}
              <rect x={teX1} y={y} width={teW} height={ROW_H}
                fill="rgba(96,165,250,0.65)" stroke="rgba(59,130,246,.5)" strokeWidth="0.5" rx="2" />

              {/* Доходность фолда справа от OOS */}
              {retStr && (
                <text x={teX2 + 4} y={y + ROW_H / 2 + 4}
                  fill={labelColor} fontSize="9" fontFamily="var(--mono)">
                  {retStr}
                </text>
              )}

              {/* Сделок фолда внутри OOS */}
              {teW > 24 && fold.n_trades > 0 && (
                <text x={teX1 + teW / 2} y={y + ROW_H / 2 + 4}
                  textAnchor="middle" fill="rgba(30,58,138,.9)"
                  fontSize="8" fontFamily="var(--mono)">
                  {fold.n_trades}
                </text>
              )}
            </g>
          );
        })}

        {/* Временная шкала снизу */}
        {tickDates.map((d, i) => {
          const xx = PAD_L + (i / (tickCount - 1)) * innerW;
          return (
            <text key={i} x={xx} y={H - PAD_B + 14}
              textAnchor="middle" fill="var(--muted-2)"
              fontSize="8" fontFamily="var(--mono)">
              {fmtDate(d)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
