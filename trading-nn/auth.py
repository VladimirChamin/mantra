"""
auth.py — аутентификация и авторизация.
SQLite (aiosqlite) + bcrypt + JWT.

Таблицы:
    users      — пользователи (id, email, password_hash, role, created_at)
    signals    — история прогнозов (id, user_id, symbol, interval, direction,
                 entry, stop_loss, take_profit, prob_up, exp_return, exp_vol,
                 risk_reward, confidence, signal_time, created_at)
"""

from __future__ import annotations

import os
import json
import sqlite3
import asyncio
import secrets
import string
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ---------------------------------------------------------------------------
DB_PATH   = Path(__file__).parent / "data" / "app.db"
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-please")
JWT_ALG    = "HS256"
JWT_TTL_H  = 24 * 7   # токен живёт 7 дней

ROLES = ("admin", "user")

bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Синхронная инициализация БД (вызывается при старте)
# ---------------------------------------------------------------------------
def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            name          TEXT    NOT NULL DEFAULT '',
            password_hash TEXT    NOT NULL,
            role          TEXT    NOT NULL DEFAULT 'user'
                            CHECK(role IN ('admin','user')),
            ai_quota      INTEGER NOT NULL DEFAULT 10,
            access_until  TEXT    DEFAULT NULL,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ai_usage (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            symbol       TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ai_analyses (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL REFERENCES users(id),
            symbol           TEXT    NOT NULL,
            signal_direction TEXT,
            signal_entry     REAL,
            verdict          TEXT,
            verdict_conf     INTEGER,
            recommendation   TEXT,
            result_json      TEXT,
            created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS signals (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL REFERENCES users(id),
            symbol       TEXT    NOT NULL,
            interval     TEXT    NOT NULL,
            direction    TEXT    NOT NULL,
            entry        REAL,
            stop_loss    REAL,
            take_profit  REAL,
            prob_up      REAL,
            exp_return   REAL,
            exp_vol      REAL,
            risk_reward  REAL,
            confidence   REAL,
            signal_time  TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS active_models (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tag        TEXT NOT NULL UNIQUE,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    # миграции для существующих БД
    for _col_sql in [
        "ALTER TABLE users ADD COLUMN ai_quota INTEGER NOT NULL DEFAULT 10",
        "ALTER TABLE users ADD COLUMN access_until TEXT DEFAULT NULL",
        "ALTER TABLE signals ADD COLUMN forecast_json TEXT DEFAULT NULL",
        "ALTER TABLE signals ADD COLUMN explanation_json TEXT DEFAULT NULL",
        "ALTER TABLE ai_analyses ADD COLUMN signal_id INTEGER DEFAULT NULL",
    ]:
        try:
            con.execute(_col_sql)
            con.commit()
        except Exception:
            pass

    con.commit()

    # создаём admin если ещё нет
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@trading.local")
    admin_pass  = os.environ.get("ADMIN_PASSWORD", "admin123")
    row = con.execute("SELECT id FROM users WHERE email=?", (admin_email,)).fetchone()
    if not row:
        ph = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt()).decode()
        con.execute(
            "INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)",
            (admin_email, "Admin", ph, "admin"),
        )
        con.commit()
        print(f"[auth] Создан admin: {admin_email} / {admin_pass}")

    con.close()


# ---------------------------------------------------------------------------
# Пользователи
# ---------------------------------------------------------------------------
def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def get_user_by_email(email: str) -> Optional[dict]:
    with _con() as con:
        row = con.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(uid: int) -> Optional[dict]:
    with _con() as con:
        row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return dict(row) if row else None


def create_user(email: str, name: str, password: str, role: str = "user") -> dict:
    if role not in ROLES:
        raise ValueError(f"Недопустимая роль: {role}")
    ph = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    with _con() as con:
        try:
            cur = con.execute(
                "INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)",
                (email, name, ph, role),
            )
            con.commit()
            return get_user_by_id(cur.lastrowid)
        except sqlite3.IntegrityError:
            raise ValueError(f"Email '{email}' уже зарегистрирован")


def list_users() -> list[dict]:
    with _con() as con:
        rows = con.execute(
            "SELECT id, email, name, role, ai_quota, access_until, created_at FROM users ORDER BY id"
        ).fetchall()
        users = [dict(r) for r in rows]
        # добавляем использование AI за текущий месяц
        for u in users:
            row = con.execute("""
                SELECT COUNT(*) FROM ai_usage
                WHERE user_id = ?
                  AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
            """, (u["id"],)).fetchone()
            u["ai_used_this_month"] = row[0] if row else 0
            u["access_active"] = _is_access_active(u)
        return users


def _is_access_active(user: dict) -> bool:
    until = user.get("access_until")
    if not until:
        return True  # без ограничения — всегда активен
    try:
        return datetime.fromisoformat(until) >= datetime.now(timezone.utc)
    except Exception:
        return True


def update_user_quota(user_id: int, ai_quota: int) -> dict:
    with _con() as con:
        con.execute("UPDATE users SET ai_quota=? WHERE id=?", (ai_quota, user_id))
        con.commit()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def update_user_access(user_id: int, access_until: Optional[str]) -> dict:
    """access_until — ISO datetime строка или None (бессрочно)."""
    with _con() as con:
        con.execute("UPDATE users SET access_until=? WHERE id=?", (access_until, user_id))
        con.commit()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def update_user_role(user_id: int, role: str) -> dict:
    if role not in ROLES:
        raise ValueError(f"Недопустимая роль: {role}")
    with _con() as con:
        con.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
        con.commit()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


# ---------------------------------------------------------------------------
# Сброс пароля
# ---------------------------------------------------------------------------
_PWD_CHARS = string.ascii_letters + string.digits

def _gen_password(length: int = 12) -> str:
    return "".join(secrets.choice(_PWD_CHARS) for _ in range(length))


def _send_email(to: str, subject: str, body_html: str) -> None:
    """Отправляет письмо через SMTP из .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)."""
    host  = os.environ.get("SMTP_HOST", "")
    port  = int(os.environ.get("SMTP_PORT", "587"))
    user  = os.environ.get("SMTP_USER", "")
    pw    = os.environ.get("SMTP_PASS", "")
    from_ = os.environ.get("SMTP_FROM", user)

    if not host or not user:
        raise RuntimeError(
            "SMTP не настроен. Добавьте SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS в .env"
        )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_
    msg["To"]      = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    with smtplib.SMTP(host, port, timeout=10) as s:
        s.ehlo()
        s.starttls()
        s.login(user, pw)
        s.sendmail(from_, [to], msg.as_string())


def reset_password(email: str) -> str:
    """Генерирует новый пароль, обновляет БД, отправляет письмо. Возвращает маскированный email."""
    user = get_user_by_email(email)
    if not user:
        # не раскрываем существование email
        return _mask_email(email)

    new_pw = _gen_password()
    ph = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    with _con() as con:
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (ph, user["id"]))
        con.commit()

    body = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;
                background:#0f1525;color:#e2e8f0;border-radius:12px;">
      <h2 style="color:#3b82f6;margin:0 0 16px">Mantra Trading</h2>
      <p>Вы запросили сброс пароля.</p>
      <p>Ваш новый пароль:</p>
      <div style="font-family:monospace;font-size:22px;font-weight:700;
                  background:#131929;border:1px solid #1e2d45;border-radius:8px;
                  padding:14px 20px;letter-spacing:2px;margin:16px 0;">
        {new_pw}
      </div>
      <p style="color:#64748b;font-size:13px;">
        Войдите и смените пароль в настройках аккаунта.<br>
        Если вы не запрашивали сброс — просто проигнорируйте это письмо.
      </p>
    </div>
    """
    _send_email(email, "Mantra Trading — новый пароль", body)
    return _mask_email(email)


def _mask_email(email: str) -> str:
    parts = email.split("@")
    if len(parts) != 2:
        return "***"
    name, domain = parts
    return name[:2] + "***@" + domain


def delete_user(user_id: int) -> None:
    with _con() as con:
        # удаляем связанные записи
        con.execute("DELETE FROM ai_usage WHERE user_id=?", (user_id,))
        con.execute("DELETE FROM signals WHERE user_id=?", (user_id,))
        con.execute("DELETE FROM users WHERE id=?", (user_id,))
        con.commit()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
def create_token(user: dict) -> str:
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_H),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Токен истёк")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")


# ---------------------------------------------------------------------------
# FastAPI зависимости
# ---------------------------------------------------------------------------
def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    payload = decode_token(creds.credentials)
    user = get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Требуются права администратора")
    return user


# ---------------------------------------------------------------------------
# История сигналов
# ---------------------------------------------------------------------------
def save_signal(user_id: int, signal: dict, forecast_json: str | None = None,
                explanation_json: str | None = None) -> int:
    with _con() as con:
        cur = con.execute("""
            INSERT INTO signals
              (user_id, symbol, interval, direction,
               entry, stop_loss, take_profit,
               prob_up, exp_return, exp_vol, risk_reward, confidence, signal_time,
               forecast_json, explanation_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            user_id,
            signal.get("symbol"),
            signal.get("interval"),
            signal.get("direction"),
            signal.get("entry"),
            signal.get("stop_loss"),
            signal.get("take_profit"),
            signal.get("prob_up"),
            signal.get("exp_return"),
            signal.get("exp_vol"),
            signal.get("risk_reward"),
            signal.get("confidence"),
            signal.get("time"),
            forecast_json,
            explanation_json,
        ))
        con.commit()
        return cur.lastrowid


def get_signals(user_id: int, limit: int = 50) -> list[dict]:
    with _con() as con:
        rows = con.execute("""
            SELECT s.*, u.email, u.name
            FROM signals s JOIN users u ON s.user_id = u.id
            WHERE s.user_id = ?
            ORDER BY s.id DESC LIMIT ?
        """, (user_id, limit)).fetchall()
        return [dict(r) for r in rows]


def get_all_signals(limit: int = 200) -> list[dict]:
    with _con() as con:
        rows = con.execute("""
            SELECT s.*, u.email, u.name
            FROM signals s JOIN users u ON s.user_id = u.id
            ORDER BY s.id DESC LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def delete_signal(signal_id: int, user_id: int) -> bool:
    with _con() as con:
        cur = con.execute(
            "DELETE FROM signals WHERE id = ? AND user_id = ?",
            (signal_id, user_id)
        )
        return cur.rowcount > 0


# ---------------------------------------------------------------------------
# AI quota
# ---------------------------------------------------------------------------
AI_MONTHLY_LIMIT = 10  # для роли user; admin — без лимита

def get_ai_usage_this_month(user_id: int) -> int:
    with _con() as con:
        row = con.execute("""
            SELECT COUNT(*) FROM ai_usage
            WHERE user_id = ?
              AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        """, (user_id,)).fetchone()
        return row[0] if row else 0


def check_ai_quota(user: dict) -> tuple[bool, int, int]:
    """Возвращает (ok, used, limit). admin всегда ok."""
    if user["role"] == "admin":
        used = get_ai_usage_this_month(user["id"])
        return True, used, 999999
    limit = user.get("ai_quota") or AI_MONTHLY_LIMIT
    used = get_ai_usage_this_month(user["id"])
    return used < limit, used, limit


def consume_ai_quota(user_id: int, symbol: str = None):
    with _con() as con:
        con.execute(
            "INSERT INTO ai_usage (user_id, symbol) VALUES (?,?)",
            (user_id, symbol)
        )
        con.commit()


def save_ai_analysis(user_id: int, result: dict, signal_id: int | None = None) -> int:
    verdict_block = result.get("verdict", {})
    with _con() as con:
        cur = con.execute(
            """INSERT INTO ai_analyses
               (user_id, symbol, signal_direction, signal_entry,
                verdict, verdict_conf, recommendation, result_json, signal_id)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                user_id,
                result.get("symbol"),
                result.get("signal_direction"),
                result.get("signal_entry"),
                verdict_block.get("verdict"),
                verdict_block.get("confidence"),
                verdict_block.get("recommendation"),
                json.dumps(result, ensure_ascii=False),
                signal_id,
            ),
        )
        con.commit()
        return cur.lastrowid


def get_ai_analyses(user_id: int, limit: int = 20) -> list[dict]:
    with _con() as con:
        rows = con.execute(
            """SELECT id, symbol, signal_direction, signal_entry,
                      verdict, verdict_conf, recommendation, created_at
               FROM ai_analyses WHERE user_id=?
               ORDER BY created_at DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_ai_analysis(analysis_id: int, user_id: int) -> dict | None:
    with _con() as con:
        row = con.execute(
            "SELECT result_json FROM ai_analyses WHERE id=? AND user_id=?",
            (analysis_id, user_id),
        ).fetchone()
    if not row:
        return None
    return json.loads(row["result_json"])


def get_ai_analysis_by_signal(signal_id: int, user_id: int) -> dict | None:
    with _con() as con:
        row = con.execute(
            "SELECT result_json FROM ai_analyses WHERE signal_id=? AND user_id=? ORDER BY id DESC LIMIT 1",
            (signal_id, user_id),
        ).fetchone()
    if not row:
        return None
    return json.loads(row["result_json"])


def delete_ai_analysis(analysis_id: int, user_id: int) -> bool:
    with _con() as con:
        cur = con.execute(
            "DELETE FROM ai_analyses WHERE id=? AND user_id=?",
            (analysis_id, user_id),
        )
    return cur.rowcount > 0


def get_ai_quota_info(user: dict) -> dict:
    ok, used, limit = check_ai_quota(user)
    return {
        "used": used,
        "limit": limit if limit < 999999 else None,
        "remaining": max(0, limit - used) if limit < 999999 else None,
        "ok": ok,
    }


# ---------------------------------------------------------------------------
# Активные модели (выбор пользователем для прогнозов)
# ---------------------------------------------------------------------------

def get_active_models() -> list[str]:
    """Возвращает список тегов активных моделей (пустой = все активны)."""
    with _con() as con:
        rows = con.execute("SELECT tag FROM active_models ORDER BY tag").fetchall()
    return [r["tag"] for r in rows]


def set_active_models(tags: list[str]) -> None:
    """Устанавливает набор активных моделей. Пустой список = все модели активны."""
    with _con() as con:
        con.execute("DELETE FROM active_models")
        for tag in tags:
            con.execute(
                "INSERT OR REPLACE INTO active_models (tag, updated_at) VALUES (?, datetime('now'))",
                (tag,)
            )
        con.commit()
