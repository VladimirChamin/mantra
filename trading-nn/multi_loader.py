"""
multi_loader.py
===============
Умный мультироутер источников данных.
  crypto           → Bybit REST (публичный, токен не нужен)
  stocks / bonds   → T-Invest (TINVEST_TOKEN из .env / админки)
  forex / commodity→ FinancialData.net (FINANCIALDATA_API_KEY) или T-Invest
"""

from __future__ import annotations
import os


def _load_bybit(symbol: str, interval: str, period: str):
    from bybit_loader import load_bybit_df
    return load_bybit_df(symbol, interval=interval, period=period, category="linear")


def _load_tinvest(symbol: str, interval: str, period: str):
    token = os.environ.get("TINVEST_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "Токен T-Invest не настроен. Укажите его в Админке → Источники данных."
        )
    from tinvest_loader import make_loader
    import trading_nn as tn
    cfg = tn.Config(symbol=symbol, interval=interval, period=period)
    return make_loader(token)(cfg)


def _load_financialdata(symbol: str, interval: str, period: str):
    api_key = os.environ.get("FINANCIALDATA_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "API-ключ FinancialData не настроен. Укажите его в Админке → Источники данных."
        )
    from financialdata_loader import load_financialdata_df
    return load_financialdata_df(symbol, interval=interval, period=period, api_key=api_key)


def _route(cfg):
    """Выбирает загрузчик по классу актива. Yahoo Finance не используется."""
    import trading_nn as tn
    asset_class = tn.detect_asset_class(cfg.symbol)

    if asset_class == "crypto":
        return _load_bybit(cfg.symbol, cfg.interval, cfg.period)

    if asset_class in ("stocks_ru", "bonds", "stocks"):
        return _load_tinvest(cfg.symbol, cfg.interval, cfg.period)

    if asset_class == "stocks_us":
        return _load_financialdata(cfg.symbol, cfg.interval, cfg.period)

    # forex, commodity — пробуем FinancialData, потом T-Invest
    fd_key = os.environ.get("FINANCIALDATA_API_KEY", "").strip()
    if fd_key:
        try:
            return _load_financialdata(cfg.symbol, cfg.interval, cfg.period)
        except Exception as e:
            print(f"[multi_loader] FinancialData ошибка, пробуем T-Invest: {e}")
    return _load_tinvest(cfg.symbol, cfg.interval, cfg.period)


def activate():
    """Регистрирует мультироутер как глобальный источник данных."""
    import trading_nn as tn
    tn.set_data_source(_route)
    print("[multi_loader] Aktivirovan: crypto->Bybit, stocks_ru/bonds->T-Invest, stocks_us->FinancialData, forex/commodity->FinancialData/T-Invest")
