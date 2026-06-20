"""
bybit_loader.py
===============
Загрузчик исторических свечей через Bybit REST API v5.
Работает без SDK — только requests. Публичный эндпоинт, токен не нужен.

Документация: https://bybit-exchange.github.io/docs/v5/market/kline
"""

from __future__ import annotations

import time
from datetime import datetime, timezone, timedelta

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd

_BASE = "https://api.bybit.com/v5/market/kline"

_INTERVAL_MAP = {
    "1m": "1",   "3m": "3",   "5m": "5",   "15m": "15",
    "30m": "30", "1h": "60",  "2h": "120", "4h": "240",
    "1d": "D",   "1w": "W",   "1M": "M",
}

_INTERVAL_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "1d": 1440, "1w": 10080,
}

_MAX_LIMIT = 1000  # Bybit отдаёт максимум 1000 свечей за запрос


def _session():
    s = requests.Session()
    retry = Retry(total=4, backoff_factor=1.5,
                  status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods={"GET"})
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def _parse_days(period: str, interval: str) -> int:
    import re
    if period:
        m = re.fullmatch(r"(\d+)\s*([dDwWyY]?)", period.strip())
        if m:
            n, u = int(m.group(1)), (m.group(2) or "d").lower()
            return n * {"d": 1, "w": 7, "y": 365}[u]
    minutes = _INTERVAL_MINUTES.get(interval, 60)
    return max(30, int(2000 * minutes / (60 * 24)))


def load_bybit_df(symbol: str, interval: str = "1h", period: str = "365d",
                  category: str = "spot") -> pd.DataFrame:
    """
    Загружает OHLCV свечи из Bybit v5.
    symbol   — например 'BTCUSDT', 'ETHUSDT'
    interval — '1m','5m','15m','30m','1h','2h','4h','1d','1w'
    category — 'spot' | 'linear' (USDT-perp) | 'inverse'
    """
    if interval not in _INTERVAL_MAP:
        raise ValueError(f"Неподдерживаемый таймфрейм '{interval}'. "
                         f"Доступно: {', '.join(_INTERVAL_MAP)}")

    days = _parse_days(period, interval)
    iv_ms = _INTERVAL_MINUTES.get(interval, 1440) * 60 * 1000

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    from_ms = now_ms - days * 86400 * 1000

    sess = _session()
    rows = []
    end_ms = now_ms

    while end_ms > from_ms:
        r = sess.get(_BASE, params={
            "category": category,
            "symbol":   symbol.upper(),
            "interval": _INTERVAL_MAP[interval],
            "end":      end_ms,
            "limit":    _MAX_LIMIT,
        }, timeout=(10, 30))

        if not r.ok:
            raise RuntimeError(f"Bybit API error {r.status_code}: {r.text[:300]}")

        data = r.json()
        if data.get("retCode", 0) != 0:
            raise RuntimeError(f"Bybit error: {data.get('retMsg')}")

        candles = data.get("result", {}).get("list", [])
        if not candles:
            break

        for c in candles:
            ts = int(c[0])
            if ts < from_ms:
                continue
            rows.append({
                "time":   ts,
                "open":   float(c[1]),
                "high":   float(c[2]),
                "low":    float(c[3]),
                "close":  float(c[4]),
                "volume": float(c[5]),
            })

        earliest = int(candles[-1][0])
        if earliest <= from_ms or len(candles) < _MAX_LIMIT:
            break
        end_ms = earliest - 1
        time.sleep(0.1)

    if not rows:
        raise ValueError(f"Bybit вернул 0 свечей для {symbol} {interval}.")

    df = (pd.DataFrame(rows)
          .assign(time=lambda d: pd.to_datetime(d["time"], unit="ms", utc=True))
          .set_index("time")
          .sort_index())
    df = df[~df.index.duplicated(keep="last")]
    print(f"[bybit] Загружено {len(df)} свечей {symbol} {interval} за ~{days} дн.")
    return df


def make_loader(category: str = "spot"):
    def _loader(cfg):
        return load_bybit_df(cfg.symbol, cfg.interval, cfg.period, category=category)
    return _loader


def use_bybit(category: str = "spot"):
    import trading_nn
    trading_nn.set_data_source(make_loader(category))
    print(f"[bybit] Bybit ({category}) подключён как источник данных.")
