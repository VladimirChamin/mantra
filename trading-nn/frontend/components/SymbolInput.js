"use client";

import { useState, useRef, useEffect } from "react";

const KIND_LABEL = {
  index:     "Индекс",
  share:     "Акция",
  crypto:    "Крипта",
  forex:     "Форекс",
  commodity: "Товар",
  bond:      "Облигация",
};

export default function SymbolInput({ value, onChange, instruments = [], placeholder = "Тикер или название" }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  // синхронизируем query когда value меняется снаружи
  useEffect(() => { setQuery(value || ""); }, [value]);

  // закрываем при клике вне
  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const q = query.trim().toUpperCase();
  const filtered = q.length === 0 ? [] : instruments.filter(i =>
    i.ticker.includes(q) ||
    i.name?.toUpperCase().includes(q)
  ).slice(0, 10);

  function select(ticker) {
    setQuery(ticker);
    onChange(ticker);
    setOpen(false);
    setActive(-1);
  }

  function handleInput(e) {
    const v = e.target.value;
    setQuery(v);
    onChange(v.toUpperCase());
    setOpen(true);
    setActive(-1);
  }

  function handleKeyDown(e) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(a => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      select(filtered[active].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // прокручиваем активный элемент в видимую область
  useEffect(() => {
    if (active >= 0 && listRef.current) {
      const el = listRef.current.children[active];
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => { if (filtered.length > 0) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{ textTransform: "uppercase" }}
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          style={{
            position: "absolute", zIndex: 100, top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--panel)", border: "1px solid var(--line)",
            borderRadius: 10, margin: 0, padding: "4px 0",
            listStyle: "none",
            maxHeight: 260, overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
        >
          {filtered.map((item, idx) => (
            <li
              key={item.ticker}
              onMouseDown={() => select(item.ticker)}
              onMouseEnter={() => setActive(idx)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 14px", cursor: "pointer",
                background: idx === active ? "var(--line)" : "transparent",
                transition: "background .08s",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{
                  fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13,
                  color: "var(--text)", letterSpacing: "0.03em",
                }}>
                  {item.ticker}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {item.name}
                </span>
              </div>
              {item.kind && (
                <span style={{
                  fontSize: 10, color: "var(--muted-2)", fontFamily: "var(--mono)",
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  background: "var(--ink)", border: "1px solid var(--line-soft)",
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {KIND_LABEL[item.kind] || item.kind}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
