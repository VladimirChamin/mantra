"""
subscriptions.py — подписки на сигналы.

Таблица subscriptions:
    id, user_id, symbol, interval, channel (telegram|email), destination,
    direction_filter (any|LONG|SHORT), min_prob, active,
    last_signal_at, last_signal_dir, created_at

Фоновый поток проверяет каждую свечу каждого активного подписчика
и шлёт уведомление, если сигнал соответствует фильтрам.
"""

from __future__ import annotations

import os
import json
import time
import smtplib
import threading
import sqlite3
import traceback
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import httpx

DB_PATH = Path(__file__).parent / "data" / "app.db"

# Интервал проверки в секундах: пауза между прогонами по всем подпискам
SCAN_INTERVAL_SECONDS = {
    "1h": 3600,
    "4h": 4 * 3600,
    "1d": 24 * 3600,
}
DEFAULT_SCAN_PAUSE = 300  # 5 минут между прогонами


# ---------------------------------------------------------------------------
# Инициализация таблицы
# ---------------------------------------------------------------------------
def init_subscriptions_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            symbol           TEXT    NOT NULL,
            interval         TEXT    NOT NULL DEFAULT '1d',
            channel          TEXT    NOT NULL DEFAULT 'telegram',
            destination      TEXT    NOT NULL,
            direction_filter TEXT    NOT NULL DEFAULT 'any',
            min_prob         REAL    NOT NULL DEFAULT 0.55,
            active           INTEGER NOT NULL DEFAULT 1,
            last_signal_at   TEXT    DEFAULT NULL,
            last_signal_dir  TEXT    DEFAULT NULL,
            created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS retrain_schedules (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            interval    TEXT    NOT NULL UNIQUE,
            freq        TEXT    NOT NULL DEFAULT 'weekly',
            time        TEXT    NOT NULL DEFAULT '02:00',
            time2       TEXT    DEFAULT NULL,
            day_of_week INTEGER DEFAULT 6,
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS retrain_history (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            interval     TEXT,
            asset_class  TEXT,
            symbols      TEXT,
            status       TEXT    NOT NULL DEFAULT 'running',
            triggered_by TEXT    NOT NULL DEFAULT 'manual',
            job_id       TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    """)
    con.commit()
    con.close()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


# ---------------------------------------------------------------------------
# CRUD подписок
# ---------------------------------------------------------------------------
def list_subscriptions(user_id: int) -> list[dict]:
    with _con() as con:
        rows = con.execute(
            "SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC", (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def create_subscription(user_id: int, data: dict) -> dict:
    with _con() as con:
        cur = con.execute("""
            INSERT INTO subscriptions
              (user_id, symbol, interval, channel, destination, direction_filter, min_prob, active)
            VALUES (?,?,?,?,?,?,?,1)
        """, (
            user_id,
            data["symbol"].upper(),
            data.get("interval", "1d"),
            data.get("channel", "telegram"),
            data["destination"],
            data.get("direction_filter", "any"),
            data.get("min_prob", 0.55),
        ))
        con.commit()
        row = con.execute("SELECT * FROM subscriptions WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)


def delete_subscription(sub_id: int, user_id: int) -> bool:
    with _con() as con:
        cur = con.execute("DELETE FROM subscriptions WHERE id=? AND user_id=?", (sub_id, user_id))
        con.commit()
        return cur.rowcount > 0


def toggle_subscription(sub_id: int, user_id: int, active: bool) -> Optional[dict]:
    with _con() as con:
        con.execute(
            "UPDATE subscriptions SET active=? WHERE id=? AND user_id=?",
            (1 if active else 0, sub_id, user_id)
        )
        con.commit()
        row = con.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
        return dict(row) if row else None


def _update_last_signal(sub_id: int, direction: str):
    with _con() as con:
        con.execute(
            "UPDATE subscriptions SET last_signal_at=datetime('now'), last_signal_dir=? WHERE id=?",
            (direction, sub_id)
        )
        con.commit()


# ---------------------------------------------------------------------------
# Расписание переобучения
# ---------------------------------------------------------------------------
def get_retrain_schedules() -> list[dict]:
    with _con() as con:
        rows = con.execute("SELECT * FROM retrain_schedules ORDER BY id").fetchall()
        return [dict(r) for r in rows]


def save_retrain_schedules(schedules: list[dict]) -> None:
    with _con() as con:
        for sc in schedules:
            existing = con.execute(
                "SELECT id FROM retrain_schedules WHERE interval=?", (sc["interval"],)
            ).fetchone()
            if existing:
                con.execute("""
                    UPDATE retrain_schedules
                    SET freq=?, time=?, time2=?, day_of_week=?, updated_at=datetime('now')
                    WHERE interval=?
                """, (sc.get("freq","weekly"), sc.get("time","02:00"),
                      sc.get("time2"), sc.get("day_of_week", 6), sc["interval"]))
            else:
                con.execute("""
                    INSERT INTO retrain_schedules (interval, freq, time, time2, day_of_week)
                    VALUES (?,?,?,?,?)
                """, (sc["interval"], sc.get("freq","weekly"), sc.get("time","02:00"),
                      sc.get("time2"), sc.get("day_of_week",6)))
        con.commit()


def log_retrain(interval: str, status: str, triggered_by: str, job_id: str = None,
                asset_class: str = None, symbols: str = None) -> int:
    with _con() as con:
        cur = con.execute("""
            INSERT INTO retrain_history (interval, status, triggered_by, job_id, asset_class, symbols)
            VALUES (?,?,?,?,?,?)
        """, (interval, status, triggered_by, job_id, asset_class, symbols))
        con.commit()
        return cur.lastrowid


def update_retrain_status(history_id: int, status: str):
    with _con() as con:
        con.execute("UPDATE retrain_history SET status=? WHERE id=?", (status, history_id))
        con.commit()


def get_retrain_history(limit: int = 50) -> list[dict]:
    with _con() as con:
        rows = con.execute(
            "SELECT * FROM retrain_history ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Уведомления
# ---------------------------------------------------------------------------
def _send_telegram(chat_id: str, message: str) -> None:
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN не задан в .env")
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    with httpx.Client(timeout=10) as client:
        r = client.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"})
        r.raise_for_status()


def _send_email_notification(to: str, subject: str, body_html: str) -> None:
    host  = os.environ.get("SMTP_HOST", "")
    port  = int(os.environ.get("SMTP_PORT", "587"))
    user  = os.environ.get("SMTP_USER", "")
    pw    = os.environ.get("SMTP_PASS", "")
    from_ = os.environ.get("SMTP_FROM", user)
    if not host or not user:
        raise RuntimeError("SMTP не настроен в .env")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_
    msg["To"]      = to
    msg.attach(MIMEText(body_html, "html", "utf-8"))
    with smtplib.SMTP(host, port, timeout=10) as s:
        s.ehlo(); s.starttls(); s.login(user, pw)
        s.sendmail(from_, [to], msg.as_string())


def send_signal_notification(sub: dict, signal: dict) -> None:
    direction = signal.get("direction", "?")
    symbol    = sub["symbol"]
    interval  = sub["interval"]
    entry     = signal.get("entry")
    sl        = signal.get("stop_loss")
    tp        = signal.get("take_profit")
    prob      = signal.get("prob_up")

    prob_str = f"{prob*100:.1f}%" if prob is not None else "—"
    entry_str = f"{entry:,.5g}" if entry else "—"
    sl_str    = f"{sl:,.5g}" if sl else "—"
    tp_str    = f"{tp:,.5g}" if tp else "—"

    if sub["channel"] == "telegram":
        emoji = "🟢" if direction == "LONG" else "🔴" if direction == "SHORT" else "⚪"
        msg = (
            f"{emoji} <b>Mantra Trading — сигнал</b>\n\n"
            f"<b>{symbol}</b> · {interval}\n"
            f"Направление: <b>{direction}</b>\n"
            f"Вход: <b>{entry_str}</b>\n"
            f"Стоп: <code>{sl_str}</code>\n"
            f"Тейк: <code>{tp_str}</code>\n"
            f"P(up): <b>{prob_str}</b>"
        )
        _send_telegram(sub["destination"], msg)

    elif sub["channel"] == "email":
        dir_color = "#2dd4a7" if direction == "LONG" else "#ff6b7a" if direction == "SHORT" else "#8593ac"
        html = f"""
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;
                    background:#0f1525;color:#e8eef9;border-radius:12px;">
          <h2 style="color:#5b8def;margin:0 0 12px">Mantra Trading — сигнал</h2>
          <div style="font-size:20px;font-weight:700;margin-bottom:4px">{symbol} · {interval}</div>
          <div style="font-size:28px;font-weight:800;color:{dir_color};margin-bottom:16px">{direction}</div>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#8593ac">Вход</td><td style="font-family:monospace;font-weight:700">{entry_str}</td></tr>
            <tr><td style="padding:8px 0;color:#8593ac">Стоп-лосс</td><td style="font-family:monospace;color:#ff6b7a">{sl_str}</td></tr>
            <tr><td style="padding:8px 0;color:#8593ac">Тейк-профит</td><td style="font-family:monospace;color:#2dd4a7">{tp_str}</td></tr>
            <tr><td style="padding:8px 0;color:#8593ac">P(up)</td><td style="font-family:monospace;font-weight:700">{prob_str}</td></tr>
          </table>
          <p style="color:#64748b;font-size:12px;margin-top:20px">
            Не является финансовой рекомендацией. Торговля сопряжена с риском потери капитала.
          </p>
        </div>
        """
        _send_email_notification(
            sub["destination"],
            f"Mantra · Сигнал {direction} {symbol} {interval}",
            html
        )


# ---------------------------------------------------------------------------
# Фоновый поток сканирования
# ---------------------------------------------------------------------------
_scan_running = False
_scan_thread: Optional[threading.Thread] = None
_forecast_fn = None  # будет установлен из api_server


def set_forecast_fn(fn):
    global _forecast_fn
    _forecast_fn = fn


def _scan_loop():
    global _scan_running
    print("[subscriptions] Фоновый сканер подписок запущен")
    while _scan_running:
        try:
            _run_scan_cycle()
        except Exception:
            traceback.print_exc()
        time.sleep(DEFAULT_SCAN_PAUSE)
    print("[subscriptions] Фоновый сканер подписок остановлен")


def _run_scan_cycle():
    if _forecast_fn is None:
        return
    with _con() as con:
        rows = con.execute(
            "SELECT * FROM subscriptions WHERE active=1"
        ).fetchall()
        subs = [dict(r) for r in rows]

    now = datetime.now(timezone.utc)
    for sub in subs:
        # проверяем, достаточно ли прошло времени с последней проверки
        last_at = sub.get("last_signal_at")
        iv = sub.get("interval", "1d")
        min_gap = SCAN_INTERVAL_SECONDS.get(iv, 3600)
        if last_at:
            try:
                last_dt = datetime.fromisoformat(last_at.replace("Z","").replace(" ", "T"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                gap = (now - last_dt).total_seconds()
                if gap < min_gap:
                    continue
            except Exception:
                pass

        try:
            result = _forecast_fn(sub["symbol"], iv)
            signal = result.get("signal")
            if not signal:
                continue

            direction = signal.get("direction", "FLAT")
            prob_up   = signal.get("prob_up", 0)

            # фильтр направления
            df = sub.get("direction_filter", "any")
            if df != "any" and direction != df:
                continue

            # фильтр вероятности
            if prob_up < sub.get("min_prob", 0.55):
                continue

            # отправляем уведомление
            try:
                send_signal_notification(sub, {**signal, "direction": direction})
                _update_last_signal(sub["id"], direction)
                print(f"[subscriptions] Уведомление отправлено: {sub['symbol']} {iv} → {direction} (sub_id={sub['id']})")
            except Exception as e:
                print(f"[subscriptions] Ошибка отправки уведомления sub_id={sub['id']}: {e}")

        except Exception as e:
            print(f"[subscriptions] Ошибка сканирования {sub['symbol']} {iv}: {e}")


def start_scanner():
    global _scan_running, _scan_thread
    if _scan_running:
        return
    _scan_running = True
    _scan_thread = threading.Thread(target=_scan_loop, daemon=True, name="sub-scanner")
    _scan_thread.start()


def stop_scanner():
    global _scan_running
    _scan_running = False
