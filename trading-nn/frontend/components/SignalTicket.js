"use client";

const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
    : "—";

export default function SignalTicket({ signal }) {
  if (!signal) {
    return <div className="empty">Сигнал появится после запроса к обученной модели.</div>;
  }
  const dir = (signal.direction || "FLAT").toLowerCase();
  const dirLabel = { long: "LONG", short: "SHORT", flat: "НЕТ ВХОДА" }[dir];
  const conf = Math.round((signal.confidence || 0) * 100);

  return (
    <div className="ticket">
      <div className="ticket-head">
        <span className="sym">{signal.symbol}</span>
        <span className={`badge ${dir}`}>{dirLabel}</span>
      </div>

      <div className="level-row">
        <span className="lab">Вход</span>
        <span className="val num">{fmt(signal.entry)}</span>
      </div>
      <div className="level-row">
        <span className="lab">Стоп-лосс</span>
        <span className="val sl num">{dir === "flat" ? "—" : fmt(signal.stop_loss)}</span>
      </div>
      <div className="level-row">
        <span className="lab">Тейк-профит</span>
        <span className="val tp num">{dir === "flat" ? "—" : fmt(signal.take_profit)}</span>
      </div>

      <div className="ticket-foot">
        <div>
          <div className="k">Риск/прибыль</div>
          <div className="v num">{signal.risk_reward ?? "—"}</div>
        </div>
        <div>
          <div className="k">P(рост)</div>
          <div className="v num">{Math.round((signal.prob_up || 0) * 100)}%</div>
        </div>
        <div>
          <div className="k">Уверенность</div>
          <div className="v num">{conf}%</div>
          <div className="confbar"><i style={{ width: `${conf}%` }} /></div>
        </div>
      </div>
    </div>
  );
}
