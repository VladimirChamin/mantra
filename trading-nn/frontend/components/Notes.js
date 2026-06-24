"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

const COLORS = [
  { key: "default", bg: "var(--panel)",      border: "var(--line)",    label: "Белый"    },
  { key: "blue",    bg: "#eff6ff",            border: "#bfdbfe",        label: "Синий"    },
  { key: "green",   bg: "#f0fdf4",            border: "#bbf7d0",        label: "Зелёный"  },
  { key: "yellow",  bg: "#fefce8",            border: "#fde68a",        label: "Жёлтый"   },
  { key: "red",     bg: "#fff1f2",            border: "#fecdd3",        label: "Красный"  },
  { key: "purple",  bg: "#faf5ff",            border: "#e9d5ff",        label: "Фиолет."  },
];

function colorStyle(key) {
  return COLORS.find(c => c.key === key) || COLORS[0];
}

function NoteCard({ note, onEdit, onDelete, onPin }) {
  const c = colorStyle(note.color);
  const date = new Date(note.updated_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12,
      padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
      boxShadow: "0 1px 3px rgba(15,24,40,.05)", position: "relative",
      transition: "box-shadow .15s",
    }}>
      {note.pinned === 1 && (
        <span style={{ position: "absolute", top: 10, right: 10, fontSize: 14 }} title="Закреплена">📌</span>
      )}
      {note.title && (
        <div style={{ fontWeight: 700, fontSize: 14, paddingRight: note.pinned ? 20 : 0, color: "var(--text)", lineHeight: 1.3 }}>
          {note.title}
        </div>
      )}
      {note.body && (
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {note.body}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{date}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => onPin(note)}
            title={note.pinned ? "Открепить" : "Закрепить"}
            style={{ ...btnSm, color: note.pinned ? "var(--primary)" : "var(--muted-2)" }}>
            📌
          </button>
          <button onClick={() => onEdit(note)} style={{ ...btnSm }}>✏️</button>
          <button onClick={() => onDelete(note.id)} style={{ ...btnSm }}>🗑</button>
        </div>
      </div>
    </div>
  );
}

const btnSm = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 14, padding: "2px 5px", borderRadius: 6,
  opacity: 0.7, transition: "opacity .15s",
};

function NoteEditor({ initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [body,  setBody]  = useState(initial?.body  || "");
  const [color, setColor] = useState(initial?.color || "default");
  const [pinned, setPinned] = useState(initial?.pinned === 1);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => { bodyRef.current?.focus(); }, []);

  async function save() {
    if (!title.trim() && !body.trim()) return;
    setSaving(true);
    await onSave({ title, body, color, pinned });
    setSaving(false);
  }

  const c = colorStyle(color);

  return (
    <div style={{
      background: c.bg, border: `1.5px solid ${c.border}`,
      borderRadius: 14, padding: "18px 18px 14px",
      boxShadow: "0 4px 20px rgba(15,24,40,.1)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Заголовок"
        style={{
          border: "none", background: "transparent", fontSize: 15,
          fontWeight: 700, color: "var(--text)", outline: "none",
          fontFamily: "var(--body)", width: "100%",
        }}
      />
      <textarea
        ref={bodyRef}
        value={body} onChange={e => setBody(e.target.value)}
        placeholder="Текст заметки…"
        rows={5}
        style={{
          border: "none", background: "transparent", fontSize: 13,
          color: "var(--text)", outline: "none", resize: "vertical",
          fontFamily: "var(--body)", lineHeight: 1.6, width: "100%",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        {/* Цвета */}
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {COLORS.map(c => (
            <button key={c.key} onClick={() => setColor(c.key)} title={c.label}
              style={{
                width: 18, height: 18, borderRadius: "50%", border: color === c.key ? "2px solid var(--text)" : `1.5px solid ${c.border}`,
                background: c.bg, cursor: "pointer", padding: 0, flexShrink: 0,
              }} />
          ))}
          {/* Закрепить */}
          <button onClick={() => setPinned(p => !p)}
            style={{ ...btnSm, fontSize: 16, opacity: pinned ? 1 : 0.4, marginLeft: 4 }}
            title={pinned ? "Открепить" : "Закрепить"}>📌</button>
        </div>
        {/* Кнопки */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel}
            style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--line)", background: "none", cursor: "pointer", fontSize: 13, color: "var(--muted)", fontFamily: "var(--body)" }}>
            Отмена
          </button>
          <button onClick={save} disabled={saving || (!title.trim() && !body.trim())}
            style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--body)", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Сохранение…" : initial ? "Сохранить" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Notes() {
  const [notes, setNotes]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState(null); // note object
  const [search, setSearch]     = useState("");
  const [err, setErr]           = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setNotes(await api.getNotes()); }
    catch { setErr("Не удалось загрузить заметки"); }
    setLoading(false);
  }

  async function handleCreate(payload) {
    try {
      const note = await api.createNote(payload);
      setNotes(prev => [note, ...prev]);
      setCreating(false);
    } catch { setErr("Ошибка создания"); }
  }

  async function handleUpdate(payload) {
    try {
      const note = await api.updateNote(editing.id, payload);
      setNotes(prev => prev.map(n => n.id === note.id ? note : n));
      setEditing(null);
    } catch { setErr("Ошибка сохранения"); }
  }

  async function handleDelete(id) {
    if (!confirm("Удалить заметку?")) return;
    try {
      await api.deleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch { setErr("Ошибка удаления"); }
  }

  async function handlePin(note) {
    try {
      const updated = await api.updateNote(note.id, {
        title: note.title, body: note.body, color: note.color,
        pinned: note.pinned !== 1,
      });
      setNotes(prev => {
        const next = prev.map(n => n.id === updated.id ? updated : n);
        return [...next].sort((a, b) => (b.pinned - a.pinned) || (b.updated_at > a.updated_at ? 1 : -1));
      });
    } catch {}
  }

  const filtered = notes.filter(n => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q);
  });

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Шапка */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "var(--display)", fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase" }}>Заметки</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>Дневник трейдера — наблюдения, идеи, торговые правила</p>
        </div>
        <button onClick={() => { setCreating(true); setEditing(null); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: "var(--primary)", color: "#fff",
            fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "var(--body)",
          }}>
          + Новая заметка
        </button>
      </div>

      {err && <div className="error" style={{ marginBottom: 14 }}>{err}</div>}

      {/* Поиск */}
      {notes.length > 2 && (
        <div style={{ marginBottom: 16 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по заметкам…"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10,
              border: "1px solid var(--line)", background: "var(--ink-2)",
              fontSize: 13, color: "var(--text)", outline: "none",
              fontFamily: "var(--body)",
            }}
          />
        </div>
      )}

      {/* Редактор новой заметки */}
      {creating && (
        <div style={{ marginBottom: 18 }}>
          <NoteEditor onSave={handleCreate} onCancel={() => setCreating(false)} />
        </div>
      )}

      {/* Список */}
      {loading ? (
        <div className="empty">Загрузка…</div>
      ) : filtered.length === 0 && !creating ? (
        <div className="empty" style={{ marginTop: 60 }}>
          {search ? "Ничего не найдено" : "Заметок пока нет. Создайте первую!"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {filtered.map(note => (
            editing?.id === note.id ? (
              <div key={note.id} style={{ gridColumn: "1 / -1" }}>
                <NoteEditor initial={note} onSave={handleUpdate} onCancel={() => setEditing(null)} />
              </div>
            ) : (
              <NoteCard key={note.id} note={note}
                onEdit={n => { setEditing(n); setCreating(false); }}
                onDelete={handleDelete}
                onPin={handlePin}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
