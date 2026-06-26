"""
auth.py — аутентификация и авторизация.
MySQL (PyMySQL) + bcrypt + JWT.
"""

from __future__ import annotations

import os
import json
import secrets
import string
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
import pymysql
import pymysql.cursors
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials


# ---------------------------------------------------------------------------
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production-please")
JWT_ALG    = "HS256"
JWT_TTL_H  = 24 * 7

ROLES = ("admin", "user")

bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Соединение с MySQL
# ---------------------------------------------------------------------------
def _con() -> pymysql.connections.Connection:
    host = os.environ.get("DB_HOST", "localhost")
    kw = dict(
        host        = host,
        user        = os.environ.get("DB_USER", "root"),
        password    = os.environ.get("DB_PASSWORD", ""),
        database    = os.environ.get("DB_NAME", "mantra"),
        charset     = "utf8mb4",
        cursorclass = pymysql.cursors.DictCursor,
        autocommit  = False,
        connect_timeout = 10,
    )
    # Пробуем без SSL, затем с SSL (reg.ru и некоторые хостинги требуют SSL)
    try:
        return pymysql.connect(**kw)
    except Exception:
        import ssl as _ssl
        ctx = _ssl.SSLContext(_ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = _ssl.CERT_NONE
        return pymysql.connect(**kw, ssl=ctx)


# ---------------------------------------------------------------------------
# Инициализация БД
# ---------------------------------------------------------------------------
def init_db() -> None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id            INT AUTO_INCREMENT PRIMARY KEY,
                    email         VARCHAR(255) NOT NULL UNIQUE,
                    name          VARCHAR(255) NOT NULL DEFAULT '',
                    password_hash VARCHAR(255) NOT NULL,
                    role          ENUM('admin','user') NOT NULL DEFAULT 'user',
                    ai_quota      INT NOT NULL DEFAULT 10,
                    access_until  DATETIME DEFAULT NULL,
                    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ai_usage (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    user_id    INT NOT NULL,
                    symbol     VARCHAR(50),
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_month (user_id, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ai_analyses (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    user_id          INT NOT NULL,
                    symbol           VARCHAR(50) NOT NULL,
                    signal_direction VARCHAR(10),
                    signal_entry     DOUBLE,
                    signal_id        INT DEFAULT NULL,
                    verdict          VARCHAR(20),
                    verdict_conf     INT,
                    recommendation   TEXT,
                    result_json      LONGTEXT,
                    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS signals (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    user_id          INT NOT NULL,
                    symbol           VARCHAR(50) NOT NULL,
                    `interval`       VARCHAR(10) NOT NULL,
                    direction        VARCHAR(10) NOT NULL,
                    entry            DOUBLE,
                    stop_loss        DOUBLE,
                    take_profit      DOUBLE,
                    prob_up          DOUBLE,
                    exp_return       DOUBLE,
                    exp_vol          DOUBLE,
                    risk_reward      DOUBLE,
                    confidence       DOUBLE,
                    signal_time      DATETIME,
                    forecast_json    LONGTEXT,
                    explanation_json LONGTEXT,
                    actuals_json     LONGTEXT,
                    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                ALTER TABLE signals ADD COLUMN IF NOT EXISTS actuals_json LONGTEXT
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS active_models (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    tag        VARCHAR(255) NOT NULL UNIQUE,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    user_id    INT NOT NULL,
                    title      TEXT NOT NULL,
                    body       LONGTEXT NOT NULL,
                    color      VARCHAR(20) NOT NULL DEFAULT 'default',
                    pinned     TINYINT(1) NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_user (user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS payments (
                    id           INT AUTO_INCREMENT PRIMARY KEY,
                    user_id      INT NOT NULL,
                    inv_id       INT NOT NULL UNIQUE,
                    amount       DECIMAL(10,2) NOT NULL,
                    description  VARCHAR(255),
                    status       ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
                    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    paid_at      DATETIME DEFAULT NULL,
                    INDEX idx_user (user_id),
                    INDEX idx_inv (inv_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
        con.commit()

        # создаём admin если нет
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@trading.local")
        admin_pass  = os.environ.get("ADMIN_PASSWORD", "admin123")
        with con.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email=%s", (admin_email,))
            if not cur.fetchone():
                ph = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt()).decode()
                cur.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (%s,%s,%s,%s)",
                    (admin_email, "Admin", ph, "admin"),
                )
                con.commit()
                print(f"[auth] Создан admin: {admin_email} / {admin_pass}")
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Пользователи
# ---------------------------------------------------------------------------
def get_user_by_email(email: str) -> Optional[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email=%s", (email,))
            return cur.fetchone()
    finally:
        con.close()


def get_user_by_id(uid: int) -> Optional[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE id=%s", (uid,))
            return cur.fetchone()
    finally:
        con.close()


def create_user(email: str, name: str, password: str, role: str = "user") -> dict:
    if role not in ROLES:
        raise ValueError(f"Недопустимая роль: {role}")
    ph = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    con = _con()
    try:
        with con.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO users (email, name, password_hash, role) VALUES (%s,%s,%s,%s)",
                    (email, name, ph, role),
                )
                con.commit()
                uid = cur.lastrowid
            except pymysql.err.IntegrityError:
                raise ValueError(f"Email '{email}' уже зарегистрирован")
        return get_user_by_id(uid)
    finally:
        con.close()


def list_users() -> list[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, email, name, role, ai_quota, access_until, created_at FROM users ORDER BY id"
            )
            users = cur.fetchall()
        for u in users:
            with con.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) as cnt FROM ai_usage
                    WHERE user_id=%s AND DATE_FORMAT(created_at,'%%Y-%%m') = DATE_FORMAT(NOW(),'%%Y-%%m')
                """, (u["id"],))
                row = cur.fetchone()
                u["ai_used_this_month"] = row["cnt"] if row else 0
            u["access_active"] = _is_access_active(u)
            # сериализуем datetime
            for k in ("access_until", "created_at"):
                if isinstance(u.get(k), datetime):
                    u[k] = u[k].isoformat()
        return list(users)
    finally:
        con.close()


def _is_access_active(user: dict) -> bool:
    until = user.get("access_until")
    if not until:
        return True
    try:
        if isinstance(until, datetime):
            return until.replace(tzinfo=timezone.utc) >= datetime.now(timezone.utc)
        return datetime.fromisoformat(str(until)) >= datetime.now(timezone.utc)
    except Exception:
        return True


def update_user_quota(user_id: int, ai_quota: int) -> dict:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("UPDATE users SET ai_quota=%s WHERE id=%s", (ai_quota, user_id))
        con.commit()
    finally:
        con.close()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def update_user_access(user_id: int, access_until: Optional[str]) -> dict:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("UPDATE users SET access_until=%s WHERE id=%s", (access_until, user_id))
        con.commit()
    finally:
        con.close()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def update_user_role(user_id: int, role: str) -> dict:
    if role not in ROLES:
        raise ValueError(f"Недопустимая роль: {role}")
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("UPDATE users SET role=%s WHERE id=%s", (role, user_id))
        con.commit()
    finally:
        con.close()
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    return user


def delete_user(user_id: int) -> None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM ai_usage WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM signals WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM notes WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM ai_analyses WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
        con.commit()
    finally:
        con.close()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# Сброс пароля / SMTP
# ---------------------------------------------------------------------------
_PWD_CHARS = string.ascii_letters + string.digits


def _gen_password(length: int = 12) -> str:
    return "".join(secrets.choice(_PWD_CHARS) for _ in range(length))


def _send_email(to: str, subject: str, body_html: str) -> None:
    host    = os.environ.get("SMTP_HOST", "")
    port    = int(os.environ.get("SMTP_PORT", "587"))
    secure  = os.environ.get("SMTP_SECURE", "").lower() in ("true", "1", "yes")
    user    = os.environ.get("SMTP_USER", "")
    pw      = os.environ.get("SMTP_PASS", "")
    from_   = os.environ.get("SMTP_FROM", user)

    if not host or not user:
        raise RuntimeError("SMTP не настроен. Добавьте SMTP_* в .env")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_
    msg["To"]      = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))

    ctx = ssl.create_default_context()
    if secure or port == 465:
        # SSL с первого байта (порт 465)
        with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as s:
            s.login(user, pw)
            s.sendmail(from_, [to], msg.as_string())
    else:
        # STARTTLS (порт 587 / 25)
        with smtplib.SMTP(host, port, timeout=15) as s:
            s.ehlo()
            s.starttls(context=ctx)
            s.login(user, pw)
            s.sendmail(from_, [to], msg.as_string())


def reset_password(email: str) -> str:
    user = get_user_by_email(email)
    if not user:
        return _mask_email(email)

    new_pw = _gen_password()
    ph = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (ph, user["id"]))
        con.commit()
    finally:
        con.close()

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


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
def create_token(user: dict) -> str:
    payload = {
        "sub":   str(user["id"]),
        "email": user["email"],
        "role":  user["role"],
        "exp":   datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_H),
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
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                INSERT INTO signals
                  (user_id, symbol, `interval`, direction,
                   entry, stop_loss, take_profit,
                   prob_up, exp_return, exp_vol, risk_reward, confidence, signal_time,
                   forecast_json, explanation_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
    finally:
        con.close()


def get_signals(user_id: int, limit: int = 50) -> list[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                SELECT s.*, u.email, u.name
                FROM signals s JOIN users u ON s.user_id = u.id
                WHERE s.user_id = %s
                ORDER BY s.id DESC LIMIT %s
            """, (user_id, limit))
            rows = cur.fetchall()
        return _serialize_rows(rows)
    finally:
        con.close()


def get_all_signals(limit: int = 200) -> list[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                SELECT s.*, u.email, u.name
                FROM signals s JOIN users u ON s.user_id = u.id
                ORDER BY s.id DESC LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
        return _serialize_rows(rows)
    finally:
        con.close()


def update_signal_actuals(signal_id: int, user_id: int, actuals_json: str) -> bool:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "UPDATE signals SET actuals_json=%s WHERE id=%s AND user_id=%s",
                (actuals_json, signal_id, user_id)
            )
            con.commit()
            return cur.rowcount > 0
    finally:
        con.close()


def delete_signal(signal_id: int, user_id: int) -> bool:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "DELETE FROM signals WHERE id=%s AND user_id=%s",
                (signal_id, user_id)
            )
            con.commit()
            return cur.rowcount > 0
    finally:
        con.close()


# ---------------------------------------------------------------------------
# AI quota
# ---------------------------------------------------------------------------
AI_MONTHLY_LIMIT = 10


def get_ai_usage_this_month(user_id: int) -> int:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) as cnt FROM ai_usage
                WHERE user_id=%s
                  AND DATE_FORMAT(created_at,'%%Y-%%m') = DATE_FORMAT(NOW(),'%%Y-%%m')
            """, (user_id,))
            row = cur.fetchone()
            return row["cnt"] if row else 0
    finally:
        con.close()


def check_ai_quota(user: dict) -> tuple[bool, int, int]:
    if user["role"] == "admin":
        used = get_ai_usage_this_month(user["id"])
        return True, used, 999999
    limit = user.get("ai_quota") or AI_MONTHLY_LIMIT
    used = get_ai_usage_this_month(user["id"])
    return used < limit, used, limit


def consume_ai_quota(user_id: int, symbol: str = None):
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO ai_usage (user_id, symbol) VALUES (%s,%s)",
                (user_id, symbol)
            )
        con.commit()
    finally:
        con.close()


def save_ai_analysis(user_id: int, result: dict, signal_id: int | None = None) -> int:
    verdict_block = result.get("verdict", {})
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                INSERT INTO ai_analyses
                   (user_id, symbol, signal_direction, signal_entry,
                    verdict, verdict_conf, recommendation, result_json, signal_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                user_id,
                result.get("symbol"),
                result.get("signal_direction"),
                result.get("signal_entry"),
                verdict_block.get("verdict"),
                verdict_block.get("confidence"),
                verdict_block.get("recommendation"),
                json.dumps(result, ensure_ascii=False),
                signal_id,
            ))
            con.commit()
            return cur.lastrowid
    finally:
        con.close()


def get_ai_analyses(user_id: int, limit: int = 20) -> list[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                SELECT id, symbol, signal_direction, signal_entry,
                       verdict, verdict_conf, recommendation, created_at
                FROM ai_analyses WHERE user_id=%s
                ORDER BY created_at DESC LIMIT %s
            """, (user_id, limit))
            rows = cur.fetchall()
        return _serialize_rows(rows)
    finally:
        con.close()


def get_ai_analysis(analysis_id: int, user_id: int) -> dict | None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT result_json FROM ai_analyses WHERE id=%s AND user_id=%s",
                (analysis_id, user_id),
            )
            row = cur.fetchone()
        if not row:
            return None
        return json.loads(row["result_json"])
    finally:
        con.close()


def get_ai_analysis_by_signal(signal_id: int, user_id: int) -> dict | None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT result_json FROM ai_analyses WHERE signal_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1",
                (signal_id, user_id),
            )
            row = cur.fetchone()
        if not row:
            return None
        return json.loads(row["result_json"])
    finally:
        con.close()


def delete_ai_analysis(analysis_id: int, user_id: int) -> bool:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "DELETE FROM ai_analyses WHERE id=%s AND user_id=%s",
                (analysis_id, user_id),
            )
            con.commit()
            return cur.rowcount > 0
    finally:
        con.close()


def get_ai_quota_info(user: dict) -> dict:
    ok, used, limit = check_ai_quota(user)
    return {
        "used":      used,
        "limit":     limit if limit < 999999 else None,
        "remaining": max(0, limit - used) if limit < 999999 else None,
        "ok":        ok,
    }


# ---------------------------------------------------------------------------
# Активные модели
# ---------------------------------------------------------------------------
def get_active_models() -> list[str]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT tag FROM active_models ORDER BY tag")
            rows = cur.fetchall()
        return [r["tag"] for r in rows]
    finally:
        con.close()


def set_active_models(tags: list[str]) -> None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM active_models")
            for tag in tags:
                cur.execute(
                    "INSERT INTO active_models (tag) VALUES (%s) ON DUPLICATE KEY UPDATE updated_at=NOW()",
                    (tag,)
                )
        con.commit()
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Заметки
# ---------------------------------------------------------------------------
def get_notes(user_id: int) -> list[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT * FROM notes WHERE user_id=%s ORDER BY pinned DESC, updated_at DESC",
                (user_id,),
            )
            rows = cur.fetchall()
        return _serialize_rows(rows)
    finally:
        con.close()


def create_note(user_id: int, title: str, body: str, color: str = "default") -> dict:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO notes (user_id, title, body, color) VALUES (%s,%s,%s,%s)",
                (user_id, title.strip(), body.strip(), color),
            )
            con.commit()
            nid = cur.lastrowid
            cur.execute("SELECT * FROM notes WHERE id=%s", (nid,))
            row = cur.fetchone()
        return _serialize_row(row)
    finally:
        con.close()


def update_note(note_id: int, user_id: int, title: str, body: str, color: str, pinned: bool) -> dict | None:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute(
                "UPDATE notes SET title=%s, body=%s, color=%s, pinned=%s WHERE id=%s AND user_id=%s",
                (title.strip(), body.strip(), color, 1 if pinned else 0, note_id, user_id),
            )
            con.commit()
            cur.execute("SELECT * FROM notes WHERE id=%s AND user_id=%s", (note_id, user_id))
            row = cur.fetchone()
        return _serialize_row(row) if row else None
    finally:
        con.close()


def delete_note(note_id: int, user_id: int) -> bool:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM notes WHERE id=%s AND user_id=%s", (note_id, user_id))
            con.commit()
            return cur.rowcount > 0
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Платежи (Robokassa)
# ---------------------------------------------------------------------------
def create_payment(user_id: int, inv_id: int, amount: float, description: str) -> dict:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("""
                INSERT INTO payments (user_id, inv_id, amount, description, status)
                VALUES (%s,%s,%s,%s,'pending')
                ON DUPLICATE KEY UPDATE status='pending'
            """, (user_id, inv_id, amount, description))
            con.commit()
            cur.execute("SELECT * FROM payments WHERE inv_id=%s", (inv_id,))
            return _serialize_row(cur.fetchone())
    finally:
        con.close()


def confirm_payment(inv_id: int) -> Optional[dict]:
    """Помечает платёж как оплаченный и продлевает доступ на 92 дня (квартал)."""
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT * FROM payments WHERE inv_id=%s", (inv_id,))
            payment = cur.fetchone()
            if not payment:
                return None
            cur.execute(
                "UPDATE payments SET status='paid', paid_at=NOW() WHERE inv_id=%s",
                (inv_id,)
            )
            # продлеваем access_until на 92 дня
            cur.execute("""
                UPDATE users SET access_until = DATE_ADD(
                    GREATEST(IFNULL(access_until, NOW()), NOW()),
                    INTERVAL 92 DAY
                ) WHERE id=%s
            """, (payment["user_id"],))
            con.commit()
            return _serialize_row(payment)
    finally:
        con.close()


def get_payment_by_inv(inv_id: int) -> Optional[dict]:
    con = _con()
    try:
        with con.cursor() as cur:
            cur.execute("SELECT * FROM payments WHERE inv_id=%s", (inv_id,))
            row = cur.fetchone()
        return _serialize_row(row) if row else None
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------
def _serialize_row(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return row
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _serialize_rows(rows) -> list[dict]:
    return [_serialize_row(dict(r)) for r in rows]
