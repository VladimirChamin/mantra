"use client";

import React, { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function apiPost(path, body) {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Ошибка ${r.status}`);
  return data;
}

// ─── цвет вердикта ────────────────────────────────────────────────────────────
function verdictColor(v) {
  if (!v) return "var(--muted2)";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "var(--long, #68d391)";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "var(--short, #fc8181)";
  return "var(--muted2, #a0aec0)";
}

function verdictEmoji(v) {
  if (!v) return "◈";
  if (v.includes("ПОДТВЕРЖДАЕТ")) return "✓";
  if (v.includes("ПРОТИВОРЕЧИТ")) return "✗";
  return "~";
}

// ─── звёзды уверенности ───────────────────────────────────────────────────────
function Confidence({ value }) {
  const n = Math.min(5, Math.max(1, value || 1));
  return (
    <span title={`Уверенность ${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < n ? "#f6ad55" : "var(--border)", fontSize: 14 }}>★</span>
      ))}
    </span>
  );
}

// ─── секция с заголовком ──────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.08em", opacity: 0.5, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── список тегов ─────────────────────────────────────────────────────────────
function TagList({ items, color }) {
  if (!items?.length) return <span style={{ opacity: 0.4 }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((t, i) => (
        <span key={i} style={{
          fontSize: 12, padding: "3px 9px", borderRadius: 12,
          background: "var(--card2, rgba(255,255,255,.05))",
          border: `1px solid ${color || "var(--border)"}`,
          color: color || "inherit",
        }}>{t}</span>
      ))}
    </div>
  );
}

// ─── On-Chain блок ────────────────────────────────────────────────────────────
function fmtLarge(n) {
  if (n == null) return "н/д";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function OnChainBlock({ onchain }) {
  if (!onchain) return null;
  const m   = onchain.market      || {};
  const der = onchain.derivatives || {};
  const ls  = onchain.long_short  || {};
  const nf  = onchain.netflow     || {};

  const rows = [
    m.market_cap_usd       && ["Рыночная капитализация", fmtLarge(m.market_cap_usd)],
    m.total_volume_24h     && ["Объём 24ч", fmtLarge(m.total_volume_24h)],
    m.price_change_24h_pct != null && ["Изм. цены 24ч", `${m.price_change_24h_pct.toFixed(2)}%`, m.price_change_24h_pct >= 0 ? "var(--long)" : "var(--short)"],
    m.price_change_7d_pct  != null && ["Изм. цены 7д",  `${m.price_change_7d_pct.toFixed(2)}%`,  m.price_change_7d_pct  >= 0 ? "var(--long)" : "var(--short)"],
    m.ath_change_pct       != null && ["От ATH", `${m.ath_change_pct.toFixed(1)}%`, "var(--muted)"],
    der.open_interest_usd  && ["Open Interest", fmtLarge(der.open_interest_usd)],
    der.funding_rate_avg   != null && ["Funding Rate", `${der.funding_rate_avg > 0 ? "+" : ""}${der.funding_rate_avg}%`, der.funding_rate_avg < 0 ? "var(--short)" : der.funding_rate_avg > 0.02 ? "var(--long)" : "var(--muted)"],
    ls.long_short_ratio    && ["Long/Short Ratio", `${ls.long_short_ratio} (L ${ls.long_pct}% / S ${ls.short_pct}%)`],
    nf.active_addresses_24h && ["Акт. адресов 24ч", Number(nf.active_addresses_24h).toLocaleString("ru-RU")],
    nf.tx_count_24h        && ["Транзакций 24ч", Number(nf.tx_count_24h).toLocaleString("ru-RU")],
    nf.avg_fee_usd         && ["Ср. комиссия", `$${nf.avg_fee_usd}`],
  ].filter(Boolean);

  if (!rows.length) return null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: 8, marginTop: 6,
    }}>
      {rows.map(([k, v, color]) => (
        <div key={k} style={{
          background: "var(--ink-2)", border: "1px solid var(--line)",
          borderRadius: 8, padding: "8px 12px",
        }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{k}</div>
          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)", color: color || "var(--text)" }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── COT индикатор ────────────────────────────────────────────────────────────
function CotBar({ cot }) {
  if (!cot) return null;
  const pct = cot.nc_bias_pct;
  const color = pct > 55 ? "var(--long, #68d391)" : pct < 45 ? "var(--short, #fc8181)" : "#a0aec0";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ opacity: 0.6 }}>Шорт {100 - pct}%</span>
        <span style={{ color, fontWeight: 600 }}>{cot.sentiment.toUpperCase()} · {pct}% лонг</span>
        <span style={{ opacity: 0.6 }}>Лонг {pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 4,
          background: `linear-gradient(90deg, var(--short, #fc8181) 0%, ${color} 100%)`,
          transition: "width .4s ease",
        }} />
      </div>
      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 5 }}>
        Нетто: {cot.nc_net > 0 ? "+" : ""}{cot.nc_net.toLocaleString("ru-RU")} контрактов
        · {cot.trend_4w} · отчёт {cot.date}
      </div>
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export function AnalysisResult({ result }) {
  if (!result) return null;
  const v = result.verdict || {};
  const verdictText = v.verdict || null;
  return (
    <div style={{ marginTop: 20 }}>
      {/* Вердикт */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 18px", borderRadius: 10,
        border: `2px solid ${verdictColor(verdictText)}`,
        background: `${verdictColor(verdictText)}15`,
      }}>
        <span style={{ fontSize: 28, lineHeight: 1, color: verdictColor(verdictText), fontWeight: 900 }}>
          {verdictEmoji(verdictText)}
        </span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: verdictColor(verdictText) }}>
            {verdictText || "—"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
            Фундаментальный анализ {verdictText?.includes("ПОДТВЕРЖДАЕТ") ? "согласен с" : verdictText?.includes("ПРОТИВОРЕЧИТ") ? "противоречит" : "нейтрален к"} сигналу нейросети
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Confidence value={v.confidence} />
        </div>
      </div>

      {v.recommendation && (
        <Section title="Вывод">
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.9 }}>{v.recommendation}</p>
        </Section>
      )}

      {v.news_summary && (
        <Section title="Новостной фон">
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>{v.news_summary}</p>
          {result.news?.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {result.news.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 11, opacity: 0.55, textDecoration: "none", color: "inherit", display: "block" }}>
                  ↗ {n.title}
                </a>
              ))}
            </div>
          )}
        </Section>
      )}

      {result.cot && (
        <Section title={`COT позиции (CFTC) · ${result.cot.market}`}>
          <CotBar cot={result.cot} />
          {v.cot_summary && <p style={{ fontSize: 13, lineHeight: 1.6, margin: "8px 0 0", opacity: 0.8 }}>{v.cot_summary}</p>}
        </Section>
      )}

      {(result.fear_greed || v.macro_summary) && (
        <Section title="Макро / Сентимент">
          {result.fear_greed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: result.fear_greed.value > 60 ? "var(--long, #68d391)" : result.fear_greed.value < 40 ? "var(--short, #fc8181)" : "#f6ad55",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 15, color: "#fff",
              }}>
                {result.fear_greed.value}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Fear & Greed: {result.fear_greed.label}</div>
                <div style={{ fontSize: 11, opacity: 0.5 }}>Crypto sentiment index</div>
              </div>
            </div>
          )}
          {v.macro_summary && <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>{v.macro_summary}</p>}
        </Section>
      )}

      {result.onchain && (
        <Section title="Рыночные данные">
          <OnChainBlock onchain={result.onchain} />
          {v.onchain_summary && <p style={{ fontSize: 13, lineHeight: 1.6, margin: "10px 0 0", opacity: 0.85 }}>{v.onchain_summary}</p>}
        </Section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.5, marginBottom: 8 }}>Ключевые риски</div>
          <TagList items={v.key_risks} color="var(--short, #fc8181)" />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.5, marginBottom: 8 }}>Катализаторы</div>
          <TagList items={v.key_catalysts} color="var(--long, #68d391)" />
        </div>
      </div>

      {result.errors?.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 11, opacity: 0.4 }}>Частичные ошибки: {result.errors.join(" · ")}</div>
      )}
      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.3 }}>
        Анализ: {result.analyzed_at?.replace("T", " ").slice(0, 16)} UTC
      </div>
    </div>
  );
}

export function AnalysisHistory() {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [openId, setOpenId]     = useState(null);
  const [fullData, setFullData] = useState({});
  const [loadingId, setLoadingId] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const { analyses } = await import("@/lib/api").then(m => m.api.listAnalyses());
        setItems(analyses || []);
      } catch { setItems([]); }
      setLoading(false);
    }
    // динамический импорт чтобы избежать проблем с SSR
    import("@/lib/api").then(({ api }) =>
      api.listAnalyses()
        .then(d => setItems(d.analyses || []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    );
  }, []);

  async function toggle(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (fullData[id]) return;
    setLoadingId(id);
    try {
      const { api } = await import("@/lib/api");
      const data = await api.getAnalysis(id);
      setFullData(d => ({ ...d, [id]: data }));
    } catch {}
    setLoadingId(null);
  }

  const verdictC = (v) => {
    if (!v) return "var(--muted-2)";
    if (v.includes("ПОДТВЕРЖДАЕТ")) return "var(--long, #68d391)";
    if (v.includes("ПРОТИВОРЕЧИТ")) return "var(--short, #fc8181)";
    return "var(--muted-2)";
  };

  if (loading) return <div className="empty">Загрузка истории…</div>;
  if (items.length === 0) return <div className="empty">История анализов пуста.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map(item => {
        const isOpen = openId === item.id;
        const vc = verdictC(item.verdict);
        return (
          <div key={item.id} style={{
            border: `1px solid ${isOpen ? vc : "var(--line)"}`,
            borderRadius: 10, overflow: "hidden",
            transition: "border-color .15s",
          }}>
            {/* Строка */}
            <button onClick={() => toggle(item.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12,
              padding: "11px 14px", background: "var(--ink)",
              border: "none", cursor: "pointer", textAlign: "left",
            }}>
              <span style={{ fontWeight: 700, fontFamily: "var(--mono)", fontSize: 14, color: "var(--text)", minWidth: 80 }}>
                {item.symbol}
              </span>
              <span style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 6,
                background: `${vc}20`, border: `1px solid ${vc}`, color: vc,
                fontWeight: 600, whiteSpace: "nowrap",
              }}>
                {item.verdict
                  ? (item.verdict.includes("ПОДТВЕРЖДАЕТ") ? "✓ Подтверждает" : item.verdict.includes("ПРОТИВОРЕЧИТ") ? "✗ Противоречит" : "~ Нейтрально")
                  : "—"}
              </span>
              {item.signal_direction && (
                <span style={{ fontSize: 12, color: item.signal_direction === "LONG" ? "var(--long)" : item.signal_direction === "SHORT" ? "var(--short)" : "var(--muted)", fontWeight: 600 }}>
                  {item.signal_direction}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--muted-2)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                {new Date(item.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted-2)", marginLeft: 6 }}>
                {isOpen ? "▲" : "▼"}
              </span>
            </button>

            {/* Раскрытое содержимое */}
            {isOpen && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}>
                {loadingId === item.id
                  ? <div style={{ padding: "20px 0", color: "var(--muted-2)", fontSize: 13 }}>Загрузка…</div>
                  : fullData[item.id]
                    ? <AnalysisResult result={fullData[item.id]} />
                    : <div style={{ padding: "20px 0", color: "var(--short)", fontSize: 13 }}>Не удалось загрузить</div>
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AIAnalysis({ signal, symbol, quota: initialQuota, onQuotaUpdate }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState("");
  const [quota, setQuota]     = useState(initialQuota);

  useEffect(() => { if (initialQuota) setQuota(initialQuota); }, [initialQuota]);

  const canRequest = !quota || quota.ok !== false;

  async function handleAnalyze() {
    if (!symbol) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const data = await apiPost("/api/analysis", {
        symbol,
        signal_direction: signal?.direction || "UNKNOWN",
        signal_entry:     signal?.entry || null,
        company_hint:     signal?.symbol || "",
      });
      setResult(data);
      if (data.quota) {
        setQuota(data.quota);
        onQuotaUpdate?.(data.quota);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const v = result?.verdict || {};
  const verdictText = v.verdict || null;

  return (
    <div style={{ marginTop: 0 }}>
      {/* Кнопка и счётчик квоты */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button
          onClick={handleAnalyze}
          disabled={loading || !symbol || !canRequest}
          style={{
            padding: "9px 20px", borderRadius: 8, border: "none",
            background: canRequest
              ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
              : "var(--border)",
            color: "#fff", fontWeight: 600, fontSize: 13,
            cursor: canRequest && !loading && symbol ? "pointer" : "not-allowed",
            opacity: loading ? 0.7 : 1,
            transition: "opacity .2s",
          }}
        >
          {loading ? "Анализирую…" : "Запустить AI-анализ"}
        </button>

        {quota && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {quota.limit
              ? `Использовано: ${quota.used}/${quota.limit} (осталось: ${quota.remaining})`
              : `Запросов: ${quota.used} (без лимита)`}
          </span>
        )}

        {!canRequest && (
          <span style={{ fontSize: 12, color: "var(--short, #fc8181)", fontWeight: 600 }}>
            Лимит исчерпан — доступен в следующем месяце
          </span>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 8,
          background: "rgba(252,129,129,.1)", border: "1px solid var(--short, #fc8181)",
          fontSize: 13, color: "var(--short, #fc8181)",
        }}>{error}</div>
      )}

      {result && <AnalysisResult result={result} />}

    </div>
  );
}

