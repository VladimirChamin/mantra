"use client";

export default function EquityChart({ curve }) {
  if (!curve || curve.length < 2) return null;

  const W = 700, H = 240, padX = 8, padY = 16;
  const eq = curve.map((p) => p.equity);
  const min = Math.min(...eq, 1);
  const max = Math.max(...eq, 1);
  const range = max - min || 1;

  const x = (i) => padX + (i / (curve.length - 1)) * (W - 2 * padX);
  const y = (v) => padY + (1 - (v - min) / range) * (H - 2 * padY);

  const line = curve.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.equity).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(curve.length - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;
  const baseY = y(1);
  const last = eq[eq.length - 1];

  return (
    <div className="chart-wrap">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Кривая капитала · старт 1.00 · финиш {last.toFixed(3)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label="Кривая капитала по сделкам">
        <defs>
          <linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b8def" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#5b8def" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-base" x1={padX} y1={baseY} x2={W - padX} y2={baseY} />
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
      </svg>
    </div>
  );
}
