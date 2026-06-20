"use client";

export default function JobLog({ job }) {
  if (!job) return null;
  const pct = Math.round((job.progress || 0) * 100);
  const running = job.status === "running" || job.status === "queued";

  const lineClass = (l) => {
    if (/ОШИБКА|ERROR/.test(l)) return "err";
    if (/Готово/.test(l)) return "ok";
    return "";
  };

  return (
    <div className="joblog">
      <div className="joblog-head">
        <span className="name">
          {job.kind === "train" ? "Обучение" : "Walk-forward"} · {job.id}
        </span>
        <span className="name">
          {running ? <span className="spinner" /> : null} {job.status} · {pct}%
        </span>
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
      <div className="log-lines">
        {(job.logs || []).slice(-40).map((l, i) => (
          <div key={i} className={lineClass(l)}>{l}</div>
        ))}
        {job.error ? <div className="err">{job.error}</div> : null}
      </div>
    </div>
  );
}
