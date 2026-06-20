"""
financialdata_loader.py
=======================
Загрузчик исторических свечей через Financial Modeling Prep API
(financialdata.net — использует FMP под капотом).

Документация API: https://financialdata.net/documentation
Токен: зарегистрируйтесь на financialdata.net → Dashboard → API Key
"""

from __future__ import annotations

import os

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd

_BASE = "https://financialmodelingprep.com/api/v3"

_INTERVAL_MAP = {
    "1m":  "1min",  "5m":  "5min",  "15m": "15min",
    "30m": "30min", "1h":  "1hour", "4h":  "4hour",
    "1d":  "daily", "1w":  "weekly", "1M": "monthly",
}


def _session():
    s = requests.Session()
    retry = Retry(total=4, backoff_factor=1.5,
                  status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods={"GET"})
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


def _parse_date_range(period: str, interval: str):
    import re
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    days = 365
    if period:
        m = re.fullmatch(r"(\d+)\s*([dDwWyY]?)", period.strip())
        if m:
            n, u = int(m.group(1)), (m.group(2) or "d").lower()
            days = n * {"d": 1, "w": 7, "y": 365}[u]
    from_dt = now - timedelta(days=days)
    return from_dt.strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")


def load_financialdata_df(symbol: str, interval: str = "1d", period: str = "365d",
                          api_key: str | None = None) -> pd.DataFrame:
    """
    Загружает OHLCV через financialdata.net / FMP API.
    symbol  — тикер: 'AAPL', 'MSFT', 'BTC/USD', 'EURUSD'
    interval — '1m','5m','15m','30m','1h','4h','1d','1w'
    api_key  — API-ключ; если None, берётся из FINANCIALDATA_API_KEY
    """
    api_key = api_key or os.environ.get("FINANCIALDATA_API_KEY")
    if not api_key:
        raise ValueError(
            "Не задан API-ключ. Установите FINANCIALDATA_API_KEY "
            "или передайте api_key=..."
        )

    if interval not in _INTERVAL_MAP:
        raise ValueError(f"Неподдерживаемый таймфрейм '{interval}'. "
                         f"Доступно: {', '.join(_INTERVAL_MAP)}")

    fmp_iv = _INTERVAL_MAP[interval]
    from_date, to_date = _parse_date_range(period, interval)
    sess = _session()

    if fmp_iv in ("daily", "weekly", "monthly"):
        url = f"{_BASE}/historical-price-full/{symbol.upper()}"
        params = {"from": from_date, "to": to_date, "apikey": api_key}
        r = sess.get(url, params=params, timeout=(10, 45))
        if not r.ok:
            raise RuntimeError(f"FinancialData API error {r.status_code}: {r.text[:300]}")
        raw = r.json().get("historical", [])
        records = [{"time": d["date"], "open": d["open"], "high": d["high"],
                    "low": d["low"], "close": d["close"], "volume": d.get("volume", 0)}
                   for d in raw]
    else:
        url = f"{_BASE}/historical-chart/{fmp_iv}/{symbol.upper()}"
        params = {"from": from_date, "to": to_date, "apikey": api_key}
        r = sess.get(url, params=params, timeout=(10, 45))
        if not r.ok:
            raise RuntimeError(f"FinancialData API error {r.status_code}: {r.text[:300]}")
        raw = r.json() if isinstance(r.json(), list) else []
        records = [{"time": d["date"], "open": d["open"], "high": d["high"],
                    "low": d["low"], "close": d["close"], "volume": d.get("volume", 0)}
                   for d in raw]

    if not records:
        raise ValueError(
            f"FinancialData вернул 0 баров для {symbol} {interval}. "
            "Проверьте тикер и API-ключ."
        )

    df = (pd.DataFrame(records)
          .assign(time=lambda d: pd.to_datetime(d["time"], utc=True))
          .set_index("time")
          .sort_index())
    df = df[~df.index.duplicated(keep="last")]
    df = df[["open", "high", "low", "close", "volume"]].dropna()
    print(f"[financialdata] Загружено {len(df)} баров {symbol} {interval}.")
    return df


def make_loader(api_key: str | None = None):
    def _loader(cfg):
        return load_financialdata_df(cfg.symbol, cfg.interval, cfg.period, api_key=api_key)
    return _loader


def use_financialdata(api_key: str | None = None):
    import trading_nn
    trading_nn.set_data_source(make_loader(api_key))
    print("[financialdata] FinancialData подключён как источник данных.")
