"use client";

function Metric({ k, v, tone }) {
  const cls = tone === "pos" ? "pos" : tone === "neg" ? "neg" : "";
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className={`v ${cls}`}>{v}</div>
    </div>
  );
}

export default function MetricGrid({ overall }) {
  if (!overall) return null;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const signTone = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");

  return (
    <div className="metrics">
      <Metric k="Сделок" v={overall.n_trades} />
      <Metric k="Винрейт" v={pct(overall.win_rate)} />
      <Metric
        k="Profit factor"
        v={overall.profit_factor}
        tone={overall.profit_factor >= 1 ? "pos" : "neg"}
      />
      <Metric k="Доходность" v={pct(overall.total_return)} tone={signTone(overall.total_return)} />
      <Metric k="Sharpe (сделка)" v={overall.sharpe} tone={signTone(overall.sharpe)} />
      <Metric k="Макс. просадка" v={pct(overall.max_drawdown)} tone="neg" />
      <Metric k="Ожидание" v={pct(overall.expectancy)} tone={signTone(overall.expectancy)} />
      <Metric k="Ср. убыток" v={pct(overall.avg_loss || 0)} tone="neg" />
    </div>
  );
}
