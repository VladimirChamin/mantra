"use client";

const fmt = (n) =>
  typeof n === "number"
    ? n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
    : "—";

const fmtPct = (n) =>
  typeof n === "number" ? `${Math.round(n * 100)}%` : "—";

export default function SignalTicket({ signal }) {
  if (!signal) {
    return <div className="empty">Сигнал появится после запроса к обученной модели.</div>;
  }
  const dir = (signal.direction || "FLAT").toLowerCase();
  const dirLabel = { long: "LONG", short: "SHORT", flat: "НЕТ ВХОДА" }[dir];
  const conf = Math.round((signal.confidence || 0) * 100);
  const orderType = signal.order_type || "MARKET";
  const isPending = orderType === "BUYSTOP" || orderType === "SELLSTOP";

  return (
    <div className="ticket">
      <div className="ticket-head">
        <span className="sym">{signal.symbol}</span>
        <span className={`badge ${dir}`}>{dirLabel}</span>
        {isPending && dir !== "flat" && (
          <span className={`badge order-type ${dir}`}>{orderType}</span>
        )}
      </div>

      {isPending && dir !== "flat" && (
        <div className="pending-banner">
          Отложенный ордер — срабатывает при касании уровня входа
        </div>
      )}

      <div className="level-row">
        <span className="lab">
          {isPending && dir !== "flat" ? `Уровень ${orderType}` : "Вход"}
        </span>
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

      {isPending && dir !== "flat" && signal.p_fill !== undefined && (
        <div className="level-row">
          <span className="lab">P(срабатывания)</span>
          <span className="val num">{fmtPct(signal.p_fill)}</span>
        </div>
      )}

      {isPending && dir !== "flat" && signal.fill_deadline && (
        <div className="level-row">
          <span className="lab">Дедлайн</span>
          <span className="val">{String(signal.fill_deadline).slice(0, 10)}</span>
        </div>
      )}

      <div className="ticket-foot">
        <div>
          <div className="k">Риск/прибыль</div>
          <div className="v num">{signal.risk_reward ?? "—"}</div>
        </div>
        <div>
          <div className="k">P(рост)</div>
          <div className="v num">{fmtPct(signal.prob_up)}</div>
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
