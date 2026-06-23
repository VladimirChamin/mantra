"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

// importance по данным FI если они есть (tag → {feature→value})
// передаётся как prop чтобы не грузить дважды

export default function FeatureEditor({ interval = "1d", modelTag = null, fiData = null, excludedValue = null, onOverrideApplied, onChange }) {
  const [groups, setGroups]       = useState(null);   // { GroupName: [feat,...] }
  const [excluded, setExcluded]   = useState(new Set());
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [collapsed, setCollapsed] = useState({});     // группа → bool

  // fi lookup: feature → importance value
  const fiMap = {};
  if (fiData?.length) {
    fiData.forEach(({ feature, importance }) => { fiMap[feature] = importance; });
  }

  useEffect(() => {
    setLoading(true);
    const p1 = api.getAllFeatures(interval).then(d => d.groups || {});
    const p2 = modelTag
      ? api.getExcludedFeatures(modelTag).then(d => new Set(d.excluded || []))
      : Promise.resolve(new Set());
    Promise.all([p1, p2])
      .then(([g, ex]) => { setGroups(g); setExcluded(ex); })
      .catch(() => setGroups({}))
      .finally(() => setLoading(false));
  }, [interval, modelTag]);

  // применяем override от кнопки "Оптимизация" (только когда не null)
  useEffect(() => {
    if (excludedValue === null) return;
    setExcluded(new Set(excludedValue));
    onChange?.(excludedValue);
    onOverrideApplied?.();   // сообщаем родителю что применили, он сбросит в null
  }, [excludedValue]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(feat) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(feat)) next.delete(feat);
      else next.add(feat);
      onChange?.([...next]);
      return next;
    });
  }

  function toggleGroup(feats, forceOn) {
    setExcluded(prev => {
      const next = new Set(prev);
      const allOff = feats.every(f => !next.has(f));
      feats.forEach(f => {
        if (forceOn !== undefined ? forceOn : allOff) next.add(f);
        else next.delete(f);
      });
      onChange?.([...next]);
      return next;
    });
  }

  async function saveToModel() {
    if (!modelTag) return;
    setSaving(true);
    try {
      await api.setExcludedFeatures(modelTag, [...excluded]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e.message);
    }
    setSaving(false);
  }

  if (loading) return <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>Загрузка признаков…</div>;
  if (!groups || !Object.keys(groups).length)
    return <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>Признаки не найдены</div>;

  const totalFeats   = Object.values(groups).flat().length;
  const activeFeats  = totalFeats - excluded.size;

  // цвет importance
  function impColor(v) {
    if (v == null) return "var(--muted-2)";
    if (v >= 0.02) return "var(--long)";
    if (v >= 0.005) return "var(--amber, #f59e0b)";
    return "var(--short)";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Шапка */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Активных признаков: <strong style={{ color: "var(--text)" }}>{activeFeats}</strong> из {totalFeats}
        </div>
        <button onClick={() => { setExcluded(new Set()); onChange?.([]); }}
          style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
          Включить все
        </button>
        {modelTag && (
          <>
            <button onClick={saveToModel} disabled={saving}
              style={{
                fontSize: 12, padding: "4px 14px", borderRadius: 6, cursor: "pointer",
                border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600,
                opacity: saving ? 0.7 : 1,
              }}>
              {saving ? "Сохранение…" : "Сохранить в модель"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "var(--long)" }}>✓ Сохранено</span>}
          </>
        )}
      </div>

      {/* Группы */}
      {Object.entries(groups).map(([group, feats]) => {
        const isCollapsed  = collapsed[group];
        const groupExcl    = feats.filter(f => excluded.has(f)).length;
        const allExcluded  = groupExcl === feats.length;
        const someExcluded = groupExcl > 0 && groupExcl < feats.length;

        return (
          <div key={group} style={{ borderBottom: "1px solid var(--line-soft)" }}>
            {/* Заголовок группы */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 4px",
              cursor: "pointer", userSelect: "none",
            }}
              onClick={() => setCollapsed(c => ({ ...c, [group]: !c[group] }))}
            >
              <span style={{ fontSize: 11, color: "var(--muted-2)", minWidth: 12 }}>
                {isCollapsed ? "▶" : "▼"}
              </span>
              {/* чекбокс группы */}
              <input
                type="checkbox"
                checked={!allExcluded}
                ref={el => { if (el) el.indeterminate = someExcluded; }}
                onChange={e => { e.stopPropagation(); toggleGroup(feats, !e.target.checked); }}
                onClick={e => e.stopPropagation()}
                style={{ accentColor: "var(--primary)", width: 14, height: 14, cursor: "pointer" }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: allExcluded ? "var(--muted-2)" : "var(--text)" }}>
                {group}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted-2)" }}>
                {feats.length - groupExcl}/{feats.length}
              </span>
            </div>

            {/* Признаки */}
            {!isCollapsed && (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 4, padding: "2px 8px 10px 28px",
              }}>
                {feats.map(feat => {
                  const isExcl = excluded.has(feat);
                  const imp    = fiMap[feat];
                  return (
                    <label key={feat} style={{
                      display: "flex", alignItems: "center", gap: 7,
                      cursor: "pointer", padding: "4px 6px", borderRadius: 6,
                      background: isExcl ? "transparent" : "var(--ink-2)",
                      border: `1px solid ${isExcl ? "transparent" : "var(--line-soft)"}`,
                      opacity: isExcl ? 0.4 : 1,
                      transition: "all .12s",
                    }}>
                      <input
                        type="checkbox"
                        checked={!isExcl}
                        onChange={() => toggle(feat)}
                        style={{ accentColor: "var(--primary)", width: 13, height: 13, cursor: "pointer", flexShrink: 0 }}
                      />
                      <span style={{
                        fontFamily: "var(--mono)", fontSize: 11, flex: 1,
                        color: isExcl ? "var(--muted-2)" : "var(--text)",
                        textDecoration: isExcl ? "line-through" : "none",
                      }}>
                        {feat}
                      </span>
                      {imp != null && (
                        <span style={{
                          fontSize: 10, fontFamily: "var(--mono)", fontWeight: 600,
                          color: impColor(imp), whiteSpace: "nowrap",
                        }}>
                          {imp >= 0 ? "+" : ""}{imp.toFixed(4)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
