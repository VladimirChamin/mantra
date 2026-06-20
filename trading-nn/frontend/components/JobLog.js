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
      <div className="log-lines">
        {(job.logs || []).slice(-40).map((l, i) => (
          <div key={i} className={lineClass(l)}>{l}</div>
        ))}
        {job.error ? <div className="err">{job.error}</div> : null}
      </div>
    </div>
  );
}
