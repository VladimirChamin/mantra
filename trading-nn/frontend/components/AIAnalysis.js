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

      {result && (
        <div style={{ marginTop: 20 }}>

          {/* Вердикт */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "14px 18px", borderRadius: 10,
            border: `2px solid ${verdictColor(verdictText)}`,
            background: `${verdictColor(verdictText)}15`,
          }}>
            <span style={{
              fontSize: 28, lineHeight: 1,
              color: verdictColor(verdictText), fontWeight: 900,
            }}>
              {verdictEmoji(verdictText)}
            </span>
            <div>
              <div style={{
                fontSize: 18, fontWeight: 700,
                color: verdictColor(verdictText),
              }}>
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

          {/* Вывод */}
          {v.recommendation && (
            <Section title="Вывод">
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.9 }}>
                {v.recommendation}
              </p>
            </Section>
          )}

          {/* Новостная сводка */}
          {v.news_summary && (
            <Section title="Новостной фон">
              <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
                {v.news_summary}
              </p>
              {result.news?.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.news.map((n, i) => (
                    <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 11, opacity: 0.55, textDecoration: "none",
                                color: "inherit", display: "block", "&:hover": { opacity: 1 } }}>
                      ↗ {n.title}
                    </a>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* COT */}
          {result.cot && (
            <Section title={`COT позиции (CFTC) · ${result.cot.market}`}>
              <CotBar cot={result.cot} />
              {v.cot_summary && (
                <p style={{ fontSize: 13, lineHeight: 1.6, margin: "8px 0 0", opacity: 0.8 }}>
                  {v.cot_summary}
                </p>
              )}
            </Section>
          )}

          {/* Макро */}
          {(result.fear_greed || v.macro_summary) && (
            <Section title="Макро / Сентимент">
              {result.fear_greed && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: result.fear_greed.value > 60
                      ? "var(--long, #68d391)"
                      : result.fear_greed.value < 40
                      ? "var(--short, #fc8181)" : "#f6ad55",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 15, color: "#fff",
                  }}>
                    {result.fear_greed.value}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Fear & Greed: {result.fear_greed.label}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>Crypto sentiment index</div>
                  </div>
                </div>
              )}
              {v.macro_summary && (
                <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
                  {v.macro_summary}
                </p>
              )}
            </Section>
          )}

          {/* Риски и катализаторы */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                            letterSpacing: "0.08em", opacity: 0.5, marginBottom: 8 }}>
                Ключевые риски
              </div>
              <TagList items={v.key_risks} color="var(--short, #fc8181)" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                            letterSpacing: "0.08em", opacity: 0.5, marginBottom: 8 }}>
                Катализаторы
              </div>
              <TagList items={v.key_catalysts} color="var(--long, #68d391)" />
            </div>
          </div>

          {/* Ошибки (если частичные) */}
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 11, opacity: 0.4 }}>
              Частичные ошибки: {result.errors.join(" · ")}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 11, opacity: 0.3 }}>
            Анализ: {result.analyzed_at?.replace("T", " ").slice(0, 16)} UTC · DeepSeek AI
          </div>
        </div>
      )}
    </div>
  );
}

