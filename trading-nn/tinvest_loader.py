"""
tinvest_loader.py
=================
Загрузчик исторических свечей через T-Invest REST API v2 (Т-Банк / Тинькофф).
Работает без SDK — только стандартные библиотеки Python + requests (уже в venv).

ТОКЕН
-----
Получить в приложении Т-Инвестиции: Профиль → Настройки → Токены для API.
Задать через переменную окружения:
    TINVEST_TOKEN=t.xxxxxxxx

ПРИМЕР
------
    from tinvest_loader import use_tinvest
    import trading_nn

    use_tinvest()
    cfg = trading_nn.Config(symbol="SBER", interval="1h", period="365d")
    trading_nn.train(cfg)
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd

# ---------------------------------------------------------------------------
# T-Invest REST API v2
# ---------------------------------------------------------------------------
_BASE            = "https://invest-public-api.tbank.ru/rest"
_INSTRUMENTS_URL = f"{_BASE}/tinkoff.public.invest.api.contract.v1.InstrumentsService"
_MARKET_URL      = f"{_BASE}/tinkoff.public.invest.api.contract.v1.MarketDataService"

_CONNECT_TIMEOUT = 10   # секунд на установку соединения
_READ_TIMEOUT    = 60   # секунд на чтение ответа

# Прокси для обхода гео-блокировок: задайте через переменную окружения
# Пример: TINVEST_PROXY=socks5://user:pass@1.2.3.4:1080
#         TINVEST_PROXY=http://1.2.3.4:3128
_PROXY = os.environ.get("TINVEST_PROXY", "").strip() or None


def _session() -> requests.Session:
    """Session с автоматическим retry на сетевые ошибки и 5xx."""
    s = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=2.0,          # паузы: 2, 4, 8 с
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods={"POST"},
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    s.mount("https://", adapter)
    if _PROXY:
        s.proxies = {"https": _PROXY, "http": _PROXY}
    return s


# Таймфреймы: строка -> значение CandleInterval для REST API
_INTERVAL_MAP = {
    "1m":  "CANDLE_INTERVAL_1_MIN",
    "2m":  "CANDLE_INTERVAL_2_MIN",
    "3m":  "CANDLE_INTERVAL_3_MIN",
    "5m":  "CANDLE_INTERVAL_5_MIN",
    "10m": "CANDLE_INTERVAL_10_MIN",
    "15m": "CANDLE_INTERVAL_15_MIN",
    "30m": "CANDLE_INTERVAL_30_MIN",
    "1h":  "CANDLE_INTERVAL_HOUR",
    "2h":  "CANDLE_INTERVAL_2_HOUR",
    "4h":  "CANDLE_INTERVAL_4_HOUR",
    "1d":  "CANDLE_INTERVAL_DAY",
    "1w":  "CANDLE_INTERVAL_WEEK",
}

# Максимальный диапазон одного запроса по таймфрейму (лимит API)
_MAX_DAYS_PER_REQUEST = {
    "1m": 1, "2m": 1, "3m": 1, "5m": 1, "10m": 1, "15m": 1, "30m": 1,
    "1h": 7, "2h": 7, "4h": 7,
    "1d": 365, "1w": 730,
}

_INTERVAL_MINUTES = {
    "1m": 1, "2m": 2, "3m": 3, "5m": 5, "10m": 10, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "1d": 1440, "1w": 10080,
}


def _quotation(q: dict) -> float:
    """{'units': '123', 'nano': 500000000} -> 123.5"""
    return int(q.get("units", 0)) + q.get("nano", 0) / 1e9


def _parse_days(period: str, interval: str) -> int:
    if period:
        m = re.fullmatch(r"(\d+)\s*([dDwWyY]?)", period.strip())
        if m:
            n = int(m.group(1))
            unit = (m.group(2) or "d").lower()
            return n * {"d": 1, "w": 7, "y": 365}[unit]
    minutes = _INTERVAL_MINUTES.get(interval, 60)
    return max(30, int(2000 * minutes / (60 * 24)))


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _looks_like_figi(s: str) -> bool:
    return bool(re.fullmatch(r"[A-Z0-9]{12}", s or ""))


def _looks_like_uid(s: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F-]{36}", s or ""))


def _find_instrument(symbol: str, token: str) -> str:
    """Тикер -> instrument_uid через REST API."""
    if _looks_like_figi(symbol) or _looks_like_uid(symbol):
        return symbol

    sym = symbol.upper()
    sess = _session()
    hdrs = _headers(token)
    timeout = (_CONNECT_TIMEOUT, _READ_TIMEOUT)

    # 1) обычный поиск (акции, ETF, облигации и пр.)
    r = sess.post(
        f"{_INSTRUMENTS_URL}/FindInstrument",
        headers=hdrs,
        json={"query": symbol, "instrumentKind": "INSTRUMENT_TYPE_UNSPECIFIED",
              "apiTradeAvailableFlag": False},
        timeout=timeout,
    )
    if r.ok:
        instruments = r.json().get("instruments", [])
        if instruments:
            def score(i):
                t_ok  = i.get("ticker", "").upper() == sym
                tqbr  = i.get("classCode", "") == "TQBR"
                trade = i.get("apiTradeAvailableFlag", True)
                return (t_ok, tqbr, trade)
            best = sorted(instruments, key=score, reverse=True)[0]
            uid = best.get("uid") or best.get("figi")
            print(f"[tinvest] {symbol} -> {best.get('ticker','?')} "
                  f"({best.get('instrumentType','?')}) uid={uid}")
            return uid

    # 2) индексы (IMOEX, RTSI) — справочник Indicatives
    r2 = sess.post(
        f"{_INSTRUMENTS_URL}/Indicatives",
        headers=hdrs,
        json={},
        timeout=timeout,
    )
    if r2.ok:
        for i in r2.json().get("instruments", []):
            if i.get("ticker", "").upper() == sym:
                uid = i.get("uid") or i.get("figi")
                print(f"[tinvest] {symbol} -> индекс {i['ticker']} uid={uid}")
                return uid

    raise ValueError(
        f"Инструмент '{symbol}' не найден в T-Invest. "
        "Проверьте тикер или передайте FIGI/uid напрямую."
    )


def _fetch_candles_chunk(uid: str, interval_str: str,
                         from_dt: datetime, to_dt: datetime,
                         token: str) -> list[dict]:
    """Один запрос GetCandles за диапазон from_dt..to_dt."""
    r = _session().post(
        f"{_MARKET_URL}/GetCandles",
        headers=_headers(token),
        json={
            "instrumentId": uid,
            "from": from_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to":   to_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "interval": _INTERVAL_MAP[interval_str],
            "candleSourceType": "CANDLE_SOURCE_UNSPECIFIED",
        },
        timeout=(_CONNECT_TIMEOUT, _READ_TIMEOUT),
    )
    if not r.ok:
        raise RuntimeError(f"T-Invest GetCandles error {r.status_code}: {r.text[:300]}")
    return r.json().get("candles", [])


def load_tinvest_df(symbol: str, interval: str = "1h", period: str = "365d",
                    token: str | None = None) -> pd.DataFrame:
    """
    Загружает свечи через T-Invest REST API v2.
    Возвращает DataFrame[open, high, low, close, volume] с индексом UTC datetime.
    Автоматически разбивает длинный диапазон на чанки по лимиту API.
    """
    token = token or os.environ.get("TINVEST_TOKEN")
    if not token:
        raise ValueError(
            "Не задан токен T-Invest. Установите переменную окружения TINVEST_TOKEN."
        )

    if interval not in _INTERVAL_MAP:
        raise ValueError(f"Неподдерживаемый таймфрейм '{interval}'. "
                         f"Доступно: {', '.join(_INTERVAL_MAP)}")

    days_total = _parse_days(period, interval)
    chunk_days = _MAX_DAYS_PER_REQUEST.get(interval, 7)

    uid = _find_instrument(symbol, token)

    now_utc = datetime.now(timezone.utc)
    from_dt  = now_utc - timedelta(days=days_total)

    all_rows: list[dict] = []
    cur = from_dt
    while cur < now_utc:
        end = min(cur + timedelta(days=chunk_days), now_utc)
        candles = _fetch_candles_chunk(uid, interval, cur, end, token)
        for c in candles:
            if not c.get("isComplete", True):
                continue
            all_rows.append({
                "time":   c["time"],
                "open":   _quotation(c["open"]),
                "high":   _quotation(c["high"]),
                "low":    _quotation(c["low"]),
                "close":  _quotation(c["close"]),
                "volume": float(c.get("volume", 0)),
            })
        cur = end
        if cur < now_utc:
            time.sleep(0.15)  # вежливая пауза между запросами

    if not all_rows:
        raise ValueError(
            f"T-Invest вернул 0 свечей для {symbol} {interval}. "
            "Проверьте тикер, таймфрейм и права токена."
        )

    df = (pd.DataFrame(all_rows)
          .assign(time=lambda d: pd.to_datetime(d["time"], utc=True))
          .set_index("time")
          .sort_index())
    df = df[~df.index.duplicated(keep="last")]
    print(f"[tinvest] Загружено {len(df)} свечей {symbol} {interval} за ~{days_total} дн.")
    return df


def make_loader(token: str | None = None):
    """Возвращает функцию-источник cfg -> DataFrame для trading_nn.set_data_source."""
    def _loader(cfg):
        return load_tinvest_df(cfg.symbol, cfg.interval, cfg.period, token=token)
    return _loader


def use_tinvest(token: str | None = None):
    """Регистрирует T-Invest как источник данных в trading_nn."""
    import trading_nn
    trading_nn.set_data_source(make_loader(token))
    print("[tinvest] T-Invest подключён как источник данных.")


if __name__ == "__main__":
    import sys
    sym = sys.argv[1] if len(sys.argv) > 1 else "SBER"
    iv  = sys.argv[2] if len(sys.argv) > 2 else "1h"
    pr  = sys.argv[3] if len(sys.argv) > 3 else "180d"
    df  = load_tinvest_df(sym, iv, pr)
    print(df.tail())
