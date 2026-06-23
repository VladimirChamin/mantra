"""
ai_analysis.py
==============
Фундаментальный AI-анализ актива для подтверждения/опровержения сигнала нейросети.

Источники данных:
  1. COT (Commitments of Traders) — CFTC public API (publicreporting.cftc.gov)
  2. Новости — Google Custom Search JSON API → полный текст каждой статьи (httpx + BS4)
  3. Макро — Fear&Greed Index (альтернативный источник, бесплатный)
  4. DeepSeek API — финальный синтез и вывод (verdict)

Итог: структурированный JSON с секциями news / cot / macro / verdict.
"""

from __future__ import annotations

import os
import re
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

# ─── конфигурация из окружения ────────────────────────────────────────────────
DEEPSEEK_API_KEY   = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE      = "https://api.deepseek.com"
DEEPSEEK_MODEL     = "deepseek-v4-pro"

GOOGLE_API_KEY     = os.environ.get("GOOGLE_API_KEY", "")
GOOGLE_CX          = os.environ.get("GOOGLE_CX", "")        # Custom Search Engine ID

CFTC_BASE          = "https://publicreporting.cftc.gov/resource/jun7-fc8e.json"

FETCH_TIMEOUT      = 12   # секунды на один HTTP-запрос
NEWS_COUNT         = 5    # сколько новостей собирать
MAX_ARTICLE_CHARS  = 3000 # ограничение текста одной статьи
MAX_NEWS_CHARS     = 8000 # суммарно новостей в промпт

# ─── вспомогательные карты ────────────────────────────────────────────────────
# COT: market_and_exchange_names → часть названия контракта для поиска
_COT_KEYWORD_MAP: dict[str, str] = {
    # Металлы
    "XAUUSD": "GOLD",        "XAGUSD": "SILVER",
    "HG": "COPPER",          "PL": "PLATINUM",
    # Энергетика
    "CL": "CRUDE OIL",       "NG": "NATURAL GAS",
    "BRENT": "BRENT",        "RB": "GASOLINE",
    # Индексы
    "ES": "S&P 500",         "NQ": "NASDAQ",
    "YM": "DOW JONES",       "RTY": "RUSSELL",
    # Форекс
    "EURUSD": "EURO FX",     "GBPUSD": "BRITISH POUND",
    "USDJPY": "JAPANESE YEN","AUDUSD": "AUSTRALIAN DOLLAR",
    "USDCAD": "CANADIAN DOLLAR",
    # Крипто (CME)
    "BTCUSDT": "BITCOIN",    "ETHUSDT": "ETHER",
    # Агро
    "ZC": "CORN",            "ZW": "WHEAT",
    "ZS": "SOYBEANS",        "KC": "COFFEE",
    "SB": "SUGAR",           "CC": "COCOA",
}

# ─── 1. COT данные ────────────────────────────────────────────────────────────

def _cot_keyword(symbol: str) -> Optional[str]:
    s = symbol.upper()
    for k, v in _COT_KEYWORD_MAP.items():
        if s == k or s.startswith(k):
            return v
    # акции — нет в COT
    return None


def fetch_cot(symbol: str) -> Optional[dict]:
    """
    Запрашивает последние 4 записи COT для актива через CFTC Socrata API.
    Возвращает словарь с ключевыми позиционными метриками или None.
    """
    keyword = _cot_keyword(symbol)
    if not keyword:
        return None

    # три месяца назад
    since = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%dT00:00:00")
    params = {
        "$where": f"upper(market_and_exchange_names) like '%{keyword}%' AND report_date_as_yyyy_mm_dd >= '{since}'",
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": "4",
        "$select": (
            "report_date_as_yyyy_mm_dd,"
            "market_and_exchange_names,"
            "noncomm_positions_long_all,noncomm_positions_short_all,"
            "comm_positions_long_all,comm_positions_short_all,"
            "change_in_noncomm_long_all,change_in_noncomm_short_all,"
            "pct_of_oi_noncomm_long_all,pct_of_oi_noncomm_short_all"
        ),
    }
    try:
        r = httpx.get(CFTC_BASE, params=params, timeout=FETCH_TIMEOUT)
        r.raise_for_status()
        rows = r.json()
    except Exception as e:
        log.warning("COT fetch error: %s", e)
        return None

    if not rows:
        return None

    latest = rows[0]

    def _int(x):
        try: return int(float(x or 0))
        except: return 0

    def _float(x):
        try: return round(float(x or 0), 2)
        except: return 0.0

    nc_long  = _int(latest.get("noncomm_positions_long_all"))
    nc_short = _int(latest.get("noncomm_positions_short_all"))
    nc_net   = nc_long - nc_short
    nc_total = nc_long + nc_short
    nc_bias  = round(nc_long / nc_total * 100, 1) if nc_total else 50.0

    chg_long  = _int(latest.get("change_in_noncomm_long_all"))
    chg_short = _int(latest.get("change_in_noncomm_short_all"))

    # динамика за 4 недели
    trend = "нейтральная"
    if len(rows) >= 2:
        prev = rows[-1]
        prev_long  = _int(prev.get("noncomm_positions_long_all"))
        prev_short = _int(prev.get("noncomm_positions_short_all"))
        prev_net   = prev_long - prev_short
        if nc_net > prev_net * 1.1:
            trend = "накопление лонгов"
        elif nc_net < prev_net * 0.9:
            trend = "накопление шортов"

    return {
        "date":       latest.get("report_date_as_yyyy_mm_dd", "")[:10],
        "market":     latest.get("market_and_exchange_names", ""),
        "nc_long":    nc_long,
        "nc_short":   nc_short,
        "nc_net":     nc_net,
        "nc_bias_pct": nc_bias,   # % лонгов среди некоммерческих
        "chg_long":   chg_long,
        "chg_short":  chg_short,
        "pct_oi_long":  _float(latest.get("pct_of_oi_noncomm_long_all")),
        "pct_oi_short": _float(latest.get("pct_of_oi_noncomm_short_all")),
        "trend_4w":   trend,
        "sentiment":  "bullish" if nc_bias > 55 else ("bearish" if nc_bias < 45 else "neutral"),
    }


# ─── 2. Google News → полный текст ───────────────────────────────────────────

def _google_news(query: str) -> list[dict]:
    """Ищет свежие новости через Google Custom Search API."""
    if not GOOGLE_API_KEY or not GOOGLE_CX:
        return []
    params = {
        "key":  GOOGLE_API_KEY,
        "cx":   GOOGLE_CX,
        "q":    query,
        "num":  NEWS_COUNT,
        "sort": "date",
        "dateRestrict": "y1",    # за последний год
        "lr": "lang_ru|lang_en",
    }
    try:
        r = httpx.get("https://www.googleapis.com/customsearch/v1",
                       params=params, timeout=FETCH_TIMEOUT)
        r.raise_for_status()
        items = r.json().get("items", [])
        return [{"title": i.get("title",""), "url": i.get("link",""),
                 "snippet": i.get("snippet","")} for i in items]
    except Exception as e:
        log.warning("Google Search error: %s", e)
        return []


def _fetch_article_text(url: str) -> str:
    """Скачивает страницу и вытаскивает основной текст."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; MantraBot/1.0)"}
        r = httpx.get(url, headers=headers, timeout=FETCH_TIMEOUT,
                      follow_redirects=True)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        # удаляем мусор
        for tag in soup(["script","style","nav","footer","header","aside","form"]):
            tag.decompose()
        # пробуем article / main, иначе body
        container = (soup.find("article")
                     or soup.find("main")
                     or soup.find("div", class_=re.compile(r"content|article|post|entry", re.I))
                     or soup.body)
        if not container:
            return ""
        text = " ".join(container.get_text(" ", strip=True).split())
        return text[:MAX_ARTICLE_CHARS]
    except Exception as e:
        log.debug("Article fetch error %s: %s", url, e)
        return ""


def fetch_news(symbol: str, company_hint: str = "") -> list[dict]:
    """
    Ищет новости по активу, скачивает тексты статей.
    Возвращает список [{title, url, text}].
    """
    query = f"{symbol} {company_hint} stock news analysis".strip()
    items = _google_news(query)
    result = []
    for item in items:
        text = _fetch_article_text(item["url"]) if item["url"] else item["snippet"]
        if not text:
            text = item["snippet"]
        result.append({"title": item["title"], "url": item["url"], "text": text})
    return result


# ─── 3. Fear & Greed (крипто — alternative.me, без ключа) ───────────────────

def fetch_fear_greed() -> Optional[dict]:
    try:
        r = httpx.get("https://api.alternative.me/fng/?limit=1", timeout=FETCH_TIMEOUT)
        r.raise_for_status()
        d = r.json()["data"][0]
        return {
            "value": int(d["value"]),
            "label": d["value_classification"],
            "date":  d["timestamp"],
        }
    except Exception:
        return None


# ─── 4. On-Chain данные (крипто, без ключа) ──────────────────────────────────

# Базовые тикеры монет из торгового тикера
_COIN_MAP = {
    "BTCUSDT": "bitcoin", "ETHUSDT": "ethereum", "SOLUSDT": "solana",
    "BNBUSDT": "binancecoin", "XRPUSDT": "ripple", "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin", "AVAXUSDT": "avalanche-2", "DOTUSDT": "polkadot",
    "LINKUSDT": "chainlink", "UNIUSDT": "uniswap", "MATICUSDT": "matic-network",
}

_COINGLASS_COIN = {
    "BTCUSDT": "BTC", "ETHUSDT": "ETH", "SOLUSDT": "SOL",
    "BNBUSDT": "BNB", "XRPUSDT": "XRP", "ADAUSDT": "ADA",
    "DOGEUSDT": "DOGE", "AVAXUSDT": "AVAX", "DOTUSDT": "DOT",
    "LINKUSDT": "LINK",
}


def _coingecko_market(coin_id: str) -> Optional[dict]:
    """Базовые on-chain метрики через CoinGecko (бесплатно, без ключа)."""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/{coin_id}"
        params = {
            "localization": "false",
            "tickers": "false",
            "market_data": "true",
            "community_data": "true",
            "developer_data": "false",
        }
        r = httpx.get(url, params=params, timeout=FETCH_TIMEOUT,
                      headers={"Accept": "application/json"})
        r.raise_for_status()
        d = r.json()
        md = d.get("market_data", {})
        cd = d.get("community_data", {})

        def _v(x):
            if isinstance(x, dict): return x.get("usd")
            return x

        return {
            "market_cap_usd":        _v(md.get("market_cap")),
            "total_volume_24h":      _v(md.get("total_volume")),
            "circulating_supply":    md.get("circulating_supply"),
            "total_supply":          md.get("total_supply"),
            "price_change_24h_pct":  md.get("price_change_percentage_24h"),
            "price_change_7d_pct":   md.get("price_change_percentage_7d"),
            "price_change_30d_pct":  md.get("price_change_percentage_30d"),
            "ath":                   _v(md.get("ath")),
            "ath_change_pct":        _v(md.get("ath_change_percentage")),
            "twitter_followers":     cd.get("twitter_followers"),
            "reddit_subscribers":    cd.get("reddit_subscribers"),
        }
    except Exception as e:
        log.debug("CoinGecko error: %s", e)
        return None


def _coinglass_funding(symbol: str) -> Optional[dict]:
    """Funding Rate + Open Interest через CoinGlass (публичный API)."""
    coin = _COINGLASS_COIN.get(symbol.upper())
    if not coin:
        return None
    try:
        # Open Interest
        r_oi = httpx.get(
            "https://open-api.coinglass.com/public/v2/open_interest",
            params={"symbol": coin},
            headers={"coinglassSecret": ""},
            timeout=FETCH_TIMEOUT,
        )
        oi_data = None
        if r_oi.status_code == 200:
            oi_json = r_oi.json()
            if oi_json.get("success") and oi_json.get("data"):
                oi_data = oi_json["data"]

        # Funding rate
        r_fr = httpx.get(
            "https://open-api.coinglass.com/public/v2/funding",
            params={"symbol": coin},
            headers={"coinglassSecret": ""},
            timeout=FETCH_TIMEOUT,
        )
        fr_data = None
        if r_fr.status_code == 200:
            fr_json = r_fr.json()
            if fr_json.get("success") and fr_json.get("data"):
                fr_data = fr_json["data"]

        if not oi_data and not fr_data:
            return None

        result: dict = {}
        if oi_data:
            total_oi = sum(x.get("openInterest", 0) for x in oi_data if isinstance(x, dict))
            result["open_interest_usd"] = total_oi
        if fr_data:
            rates = [x.get("fundingRate", 0) for x in fr_data if isinstance(x, dict) and x.get("fundingRate") is not None]
            if rates:
                avg_rate = sum(rates) / len(rates)
                result["funding_rate_avg"] = round(avg_rate * 100, 4)
                result["funding_sentiment"] = (
                    "лонги платят шортам" if avg_rate < 0
                    else "шорты платят лонгам" if avg_rate > 0
                    else "нейтрально"
                )
        return result or None
    except Exception as e:
        log.debug("CoinGlass error: %s", e)
        return None


def _longshort_ratio(symbol: str) -> Optional[dict]:
    """Long/Short ratio с Binance (публичный, без ключа)."""
    # Binance endpoint для глобального LS ratio
    base = symbol.upper().replace("USDT", "") + "USDT"
    try:
        r = httpx.get(
            "https://fapi.binance.com/futures/data/globalLongShortAccountRatio",
            params={"symbol": base, "period": "1h", "limit": 3},
            timeout=FETCH_TIMEOUT,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return None
        latest = rows[0]
        ls = float(latest.get("longShortRatio", 1.0))
        long_pct = float(latest.get("longAccount", 0.5)) * 100
        return {
            "long_short_ratio": round(ls, 3),
            "long_pct": round(long_pct, 1),
            "short_pct": round(100 - long_pct, 1),
            "sentiment": "лонги доминируют" if ls > 1.2 else ("шорты доминируют" if ls < 0.8 else "баланс"),
        }
    except Exception as e:
        log.debug("Binance LS error: %s", e)
        return None


def _exchange_netflow(symbol: str) -> Optional[dict]:
    """Приток/отток монет на биржи через CryptoQuant community (без ключа, BTC/ETH)."""
    # Используем CoinGecko exchange_volume как прокси для netflow
    coin = _COIN_MAP.get(symbol.upper())
    if not coin or coin not in ("bitcoin", "ethereum"):
        return None
    try:
        # blockchain.info для BTC: число транзакций и активные адреса
        if coin == "bitcoin":
            r = httpx.get("https://blockchain.info/stats?format=json", timeout=FETCH_TIMEOUT)
            r.raise_for_status()
            d = r.json()
            return {
                "active_addresses_24h": d.get("n_unique_addresses"),
                "tx_count_24h":         d.get("n_tx"),
                "avg_fee_usd":          round(d.get("total_fees_usd", 0) / max(d.get("n_tx", 1), 1), 2),
                "hash_rate":            d.get("hash_rate"),
                "difficulty":           d.get("difficulty"),
                "note": "blockchain.info / BTC",
            }
    except Exception as e:
        log.debug("blockchain.info error: %s", e)
    return None


def fetch_onchain(symbol: str) -> Optional[dict]:
    """
    Агрегирует on-chain данные из нескольких источников.
    Возвращает None если символ не является криптой.
    """
    sym = symbol.upper()
    coin_id = _COIN_MAP.get(sym)
    if not coin_id:
        return None

    result: dict = {"symbol": sym}
    errors = []

    # CoinGecko market + community data
    cg = _coingecko_market(coin_id)
    if cg:
        result["market"] = cg
    else:
        errors.append("coingecko")

    # Funding Rate + OI (CoinGlass)
    cg_der = _coinglass_funding(sym)
    if cg_der:
        result["derivatives"] = cg_der

    # Long/Short ratio (Binance Futures)
    ls = _longshort_ratio(sym)
    if ls:
        result["long_short"] = ls

    # Exchange netflow (blockchain.info для BTC)
    nf = _exchange_netflow(sym)
    if nf:
        result["netflow"] = nf

    if errors:
        result["errors"] = errors

    return result if len(result) > 2 else None


# ─── 5. Фундаментал: РФ акции через T-Invest ─────────────────────────────────

_TINVEST_BASE = "https://invest-public-api.tbank.ru/rest"
_TINVEST_TOKEN = os.environ.get("TINVEST_TOKEN", "")

# Известные тикеры MOEX → uid (кэш чтобы не делать поиск при каждом вызове)
_TINVEST_UID_CACHE: dict[str, str] = {}

_RU_STOCKS = {
    "SBER", "GAZP", "LKOH", "NVTK", "YDEX", "GMKN", "ROSN", "TATN",
    "MGNT", "VTBR", "ALRS", "POLY", "CHMF", "NLMK", "MTSS", "AFLT",
    "IRAO", "MOEX", "TCSG", "RUAL", "PIKK", "OZON", "VKCO", "SNGS",
}


def _is_ru_stock(symbol: str) -> bool:
    return symbol.upper() in _RU_STOCKS


def _tinvest_find_uid(symbol: str) -> Optional[str]:
    if not _TINVEST_TOKEN:
        return None
    sym = symbol.upper()
    if sym in _TINVEST_UID_CACHE:
        return _TINVEST_UID_CACHE[sym]
    try:
        r = httpx.post(
            f"{_TINVEST_BASE}/tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument",
            headers={"Authorization": f"Bearer {_TINVEST_TOKEN}", "Content-Type": "application/json"},
            json={"query": sym, "instrumentKind": "INSTRUMENT_TYPE_UNSPECIFIED", "apiTradeAvailableFlag": False},
            timeout=FETCH_TIMEOUT,
        )
        items = r.json().get("instruments", [])
        best = next((x for x in items if x.get("ticker", "").upper() == sym and x.get("classCode") == "TQBR"), None)
        if not best and items:
            best = items[0]
        uid = best.get("uid") if best else None
        if uid:
            _TINVEST_UID_CACHE[sym] = uid
        return uid
    except Exception as e:
        log.debug("T-Invest FindInstrument error: %s", e)
        return None


def fetch_ru_fundamentals(symbol: str) -> Optional[dict]:
    """
    Фундаментальные данные по акции РФ через T-Invest GetFundamentals.
    Возвращает словарь с ключевыми мультипликаторами или None.
    """
    if not _TINVEST_TOKEN:
        log.debug("TINVEST_TOKEN не задан — фундаментал РФ недоступен")
        return None
    uid = _tinvest_find_uid(symbol)
    if not uid:
        return None
    try:
        r = httpx.post(
            f"{_TINVEST_BASE}/tinkoff.public.invest.api.contract.v1.InstrumentsService/GetFundamentals",
            headers={"Authorization": f"Bearer {_TINVEST_TOKEN}", "Content-Type": "application/json"},
            json={"assets": [uid]},
            timeout=FETCH_TIMEOUT,
        )
        r.raise_for_status()
        items = r.json().get("fundamentals", [])
        if not items:
            return None
        f = items[0]

        def _f(x):
            try: return round(float(x), 4) if x is not None else None
            except: return None

        return {
            "currency":         f.get("currency"),
            "market_cap":       _f(f.get("marketCapitalization")),
            "ev":               _f(f.get("enterpriseValue")),
            "pe":               _f(f.get("peRatioTtm")),
            "pb":               _f(f.get("priceToBook")),
            "ps":               _f(f.get("priceToSales")),
            "ev_ebitda":        _f(f.get("evToEbitda")),
            "debt_equity":      _f(f.get("totalDebtToEquity")),
            "current_ratio":    _f(f.get("currentRatio")),
            "revenue":          _f(f.get("totalRevenueTtm")),
            "net_income":       _f(f.get("netIncomeTtm")),
            "ebitda":           _f(f.get("ebitdaTtm")),
            "roe":              _f(f.get("roe")),
            "roa":              _f(f.get("roa")),
            "net_margin":       _f(f.get("netMargin")),
            "revenue_growth":   _f(f.get("revenueGrowth5Y")),
            "eps_growth":       _f(f.get("epsGrowth5Y")),
            "dividend_yield":   _f(f.get("dividendYieldDailyTtm")),
            "payout_ratio":     _f(f.get("dividendPayout")),
            "beta":             _f(f.get("beta")),
            "week52_high":      _f(f.get("week52HighPrice")),
            "week52_low":       _f(f.get("week52LowPrice")),
            "free_cash_flow":   _f(f.get("freeCashFlowTtm")),
        }
    except Exception as e:
        log.warning("T-Invest GetFundamentals error: %s", e)
        return None


# ─── 6. Фундаментал: США акции через yfinance ─────────────────────────────────

# Тикеры американских акций (простая эвристика: нет числовых символов, нет USDT/USD)
def _is_us_stock(symbol: str) -> bool:
    sym = symbol.upper()
    if sym in _RU_STOCKS:
        return False
    if any(x in sym for x in ("USDT", "USD", "EUR", "GBP", "JPY", "XAU", "XAG")):
        return False
    if _COIN_MAP.get(sym):
        return False
    # Американские тикеры: 1-5 букв латиницы
    import re as _re
    return bool(_re.fullmatch(r"[A-Z]{1,5}", sym))


def fetch_us_fundamentals(symbol: str) -> Optional[dict]:
    """
    Фундаментальные данные по акции США через yfinance (бесплатно, без ключа).
    Возвращает словарь с мультипликаторами, P&L, балансом или None.
    """
    try:
        import yfinance as yf
    except ImportError:
        log.debug("yfinance не установлен")
        return None

    try:
        ticker = yf.Ticker(symbol.upper())
        info = ticker.info or {}

        def _v(key):
            v = info.get(key)
            try: return round(float(v), 4) if v is not None else None
            except: return None

        def _big(key):
            v = info.get(key)
            try: return int(v) if v is not None else None
            except: return None

        # Баланс: берём последний год
        bs = ticker.balance_sheet
        inc = ticker.income_stmt
        cf = ticker.cash_flow

        def _sheet_val(df, *rows):
            if df is None or df.empty:
                return None
            for row in rows:
                if row in df.index:
                    v = df.loc[row].iloc[0]
                    try: return int(v) if not (v != v) else None  # NaN check
                    except: return None
            return None

        total_assets     = _sheet_val(bs, "Total Assets")
        total_liab       = _sheet_val(bs, "Total Liabilities Net Minority Interest", "Total Liab")
        equity           = _sheet_val(bs, "Stockholders Equity", "Total Stockholder Equity")
        cash             = _sheet_val(bs, "Cash And Cash Equivalents", "Cash")
        total_debt       = _sheet_val(bs, "Total Debt", "Long Term Debt")
        revenue          = _sheet_val(inc, "Total Revenue")
        gross_profit     = _sheet_val(inc, "Gross Profit")
        operating_income = _sheet_val(inc, "Operating Income")
        net_income       = _sheet_val(inc, "Net Income")
        ebitda           = _sheet_val(inc, "EBITDA", "Normalized EBITDA")
        free_cash_flow   = _sheet_val(cf, "Free Cash Flow")

        return {
            # Мультипликаторы
            "pe":               _v("trailingPE"),
            "forward_pe":       _v("forwardPE"),
            "pb":               _v("priceToBook"),
            "ps":               _v("priceToSalesTrailing12Months"),
            "ev_ebitda":        _v("enterpriseToEbitda"),
            "ev":               _big("enterpriseValue"),
            "market_cap":       _big("marketCap"),
            # Рентабельность
            "roe":              _v("returnOnEquity"),
            "roa":              _v("returnOnAssets"),
            "gross_margin":     _v("grossMargins"),
            "operating_margin": _v("operatingMargins"),
            "net_margin":       _v("profitMargins"),
            # Долг
            "debt_equity":      _v("debtToEquity"),
            "current_ratio":    _v("currentRatio"),
            "quick_ratio":      _v("quickRatio"),
            # Рост
            "revenue_growth":   _v("revenueGrowth"),
            "earnings_growth":  _v("earningsGrowth"),
            # Дивиденды
            "dividend_yield":   _v("dividendYield"),
            "payout_ratio":     _v("payoutRatio"),
            # Прочее
            "beta":             _v("beta"),
            "total_debt":       _big("totalDebt"),
            "total_cash":       _big("totalCash"),
            # Из отчётности
            "revenue":          revenue,
            "gross_profit":     gross_profit,
            "operating_income": operating_income,
            "net_income":       net_income,
            "ebitda":           ebitda,
            "free_cash_flow":   free_cash_flow,
            "total_assets":     total_assets,
            "total_liabilities": total_liab,
            "equity":           equity,
            "cash":             cash,
            "total_debt_bs":    total_debt,
            # Мета
            "sector":       info.get("sector"),
            "industry":     info.get("industry"),
            "country":      info.get("country"),
            "employees":    info.get("fullTimeEmployees"),
        }
    except Exception as e:
        log.warning("yfinance fundamentals error for %s: %s", symbol, e)
        return None


# ─── 5. DeepSeek синтез ───────────────────────────────────────────────────────

_SYSTEM_PROMPT = """Ты — опытный финансовый аналитик. Твоя задача — дать краткий,
структурированный фундаментальный анализ актива и сказать, подтверждает ли он
торговый сигнал нейронной сети. Отвечай строго по секциям. Будь конкретен,
избегай воды. Используй русский язык."""

def _fmt_large(n) -> str:
    if n is None: return "н/д"
    if n >= 1e9: return f"{n/1e9:.2f}B"
    if n >= 1e6: return f"{n/1e6:.2f}M"
    if n >= 1e3: return f"{n/1e3:.1f}K"
    return str(n)


def _fmt_pct(v) -> str:
    if v is None: return "н/д"
    return f"{v*100:.1f}%"

def _fmt_big(n) -> str:
    if n is None: return "н/д"
    if abs(n) >= 1e12: return f"{n/1e12:.2f}T"
    if abs(n) >= 1e9:  return f"{n/1e9:.2f}B"
    if abs(n) >= 1e6:  return f"{n/1e6:.2f}M"
    if abs(n) >= 1e3:  return f"{n/1e3:.1f}K"
    return str(n)


def _build_prompt(
    symbol: str,
    signal_direction: str,
    signal_entry: Optional[float],
    news_items: list[dict],
    cot: Optional[dict],
    fear_greed: Optional[dict],
    onchain: Optional[dict] = None,
    fundamentals: Optional[dict] = None,
    fundamentals_source: str = "",
) -> str:
    lines = [f"## Актив: {symbol}"]
    lines.append(f"## Сигнал нейросети: {signal_direction}"
                 + (f" (вход ≈ {signal_entry})" if signal_entry else ""))
    lines.append("")

    # Фундаментальные данные
    if fundamentals:
        src = f" ({fundamentals_source})" if fundamentals_source else ""
        lines.append(f"## Фундаментальный анализ{src}")
        f = fundamentals
        sector = f.get("sector") or f.get("industry")
        if sector:
            lines.append(f"- Сектор / отрасль: {sector}")
        if f.get("market_cap"):
            lines.append(f"- Рыночная капитализация: {_fmt_big(f['market_cap'])}")
        if f.get("ev"):
            lines.append(f"- Enterprise Value: {_fmt_big(f['ev'])}")
        # Мультипликаторы
        mults = []
        if f.get("pe")       is not None: mults.append(f"P/E={f['pe']:.1f}")
        if f.get("forward_pe") is not None: mults.append(f"P/E(fwd)={f['forward_pe']:.1f}")
        if f.get("pb")       is not None: mults.append(f"P/B={f['pb']:.2f}")
        if f.get("ps")       is not None: mults.append(f"P/S={f['ps']:.2f}")
        if f.get("ev_ebitda") is not None: mults.append(f"EV/EBITDA={f['ev_ebitda']:.1f}")
        if mults:
            lines.append(f"- Мультипликаторы: {', '.join(mults)}")
        # Рентабельность
        rets = []
        if f.get("roe")             is not None: rets.append(f"ROE={_fmt_pct(f['roe'])}")
        if f.get("roa")             is not None: rets.append(f"ROA={_fmt_pct(f['roa'])}")
        if f.get("net_margin")      is not None: rets.append(f"Чист.маржа={_fmt_pct(f['net_margin'])}")
        if f.get("gross_margin")    is not None: rets.append(f"Валов.маржа={_fmt_pct(f['gross_margin'])}")
        if f.get("operating_margin") is not None: rets.append(f"Опер.маржа={_fmt_pct(f['operating_margin'])}")
        if rets:
            lines.append(f"- Рентабельность: {', '.join(rets)}")
        # Долг
        debt = []
        if f.get("debt_equity")   is not None: debt.append(f"D/E={f['debt_equity']:.2f}")
        if f.get("current_ratio") is not None: debt.append(f"Current={f['current_ratio']:.2f}")
        if f.get("quick_ratio")   is not None: debt.append(f"Quick={f['quick_ratio']:.2f}")
        if debt:
            lines.append(f"- Долговая нагрузка: {', '.join(debt)}")
        # P&L
        if f.get("revenue")        is not None: lines.append(f"- Выручка (TTM): {_fmt_big(f['revenue'])}")
        if f.get("ebitda")         is not None: lines.append(f"- EBITDA: {_fmt_big(f['ebitda'])}")
        if f.get("net_income")     is not None: lines.append(f"- Чистая прибыль: {_fmt_big(f['net_income'])}")
        if f.get("free_cash_flow") is not None: lines.append(f"- Free Cash Flow: {_fmt_big(f['free_cash_flow'])}")
        # Баланс
        if f.get("total_assets")      is not None: lines.append(f"- Активы: {_fmt_big(f['total_assets'])}")
        if f.get("total_liabilities") is not None: lines.append(f"- Обязательства: {_fmt_big(f['total_liabilities'])}")
        if f.get("equity")            is not None: lines.append(f"- Собственный капитал: {_fmt_big(f['equity'])}")
        if f.get("cash")              is not None: lines.append(f"- Денежные средства: {_fmt_big(f['cash'])}")
        # Рост
        grow = []
        if f.get("revenue_growth")  is not None: grow.append(f"Выручка={_fmt_pct(f['revenue_growth'])}")
        if f.get("earnings_growth") is not None: grow.append(f"EPS={_fmt_pct(f['earnings_growth'])}")
        if f.get("eps_growth")      is not None: grow.append(f"EPS(5y)={_fmt_pct(f['eps_growth'])}")
        if f.get("revenue_growth")  is not None and "5Y" in fundamentals_source: grow.append(f"Выручка(5y)={_fmt_pct(f['revenue_growth'])}")
        if grow:
            lines.append(f"- Рост: {', '.join(dict.fromkeys(grow))}")
        # Дивиденды
        if f.get("dividend_yield") is not None:
            lines.append(f"- Дивидендная доходность: {_fmt_pct(f['dividend_yield'])}"
                        + (f", payout={_fmt_pct(f['payout_ratio'])}" if f.get("payout_ratio") else ""))
        if f.get("beta") is not None:
            lines.append(f"- Beta: {f['beta']:.2f}")
        lines.append("")

    # COT
    if cot:
        lines.append("## Позиции COT (CFTC, некоммерческие трейдеры)")
        lines.append(f"- Дата отчёта: {cot['date']}")
        lines.append(f"- Лонг / Шорт: {cot['nc_long']:,} / {cot['nc_short']:,} (нетто: {cot['nc_net']:+,})")
        lines.append(f"- Доля лонгов: {cot['nc_bias_pct']}% → {cot['sentiment']}")
        lines.append(f"- Изменение за неделю: лонг {cot['chg_long']:+,}, шорт {cot['chg_short']:+,}")
        lines.append(f"- Тренд позиций за 4 недели: {cot['trend_4w']}")
        lines.append("")

    # Fear & Greed
    if fear_greed:
        lines.append("## Crypto Fear & Greed Index")
        lines.append(f"- Значение: {fear_greed['value']} / 100 — {fear_greed['label']}")
        lines.append("")

    # On-Chain
    if onchain:
        lines.append("## On-Chain данные")
        m = onchain.get("market", {})
        if m:
            lines.append(f"- Рыночная капитализация: ${_fmt_large(m.get('market_cap_usd'))}")
            lines.append(f"- Объём за 24ч: ${_fmt_large(m.get('total_volume_24h'))}")
            lines.append(f"- Изменение цены: 24ч {m.get('price_change_24h_pct','н/д'):.1f}%, "
                         f"7д {m.get('price_change_7d_pct','н/д'):.1f}%, "
                         f"30д {m.get('price_change_30d_pct','н/д'):.1f}%")
            if m.get("ath_change_pct") is not None:
                lines.append(f"- Отклонение от ATH: {m['ath_change_pct']:.1f}%")
            if m.get("circulating_supply") and m.get("total_supply"):
                pct_circ = m["circulating_supply"] / m["total_supply"] * 100
                lines.append(f"- Оборотное предложение: {pct_circ:.1f}% от максимума")

        der = onchain.get("derivatives", {})
        if der:
            lines.append(f"- Open Interest: ${_fmt_large(der.get('open_interest_usd'))}")
            if "funding_rate_avg" in der:
                lines.append(f"- Funding Rate (ср.): {der['funding_rate_avg']:+.4f}% → {der.get('funding_sentiment','')}")

        ls = onchain.get("long_short", {})
        if ls:
            lines.append(f"- Long/Short Ratio: {ls.get('long_short_ratio')} "
                         f"(лонги {ls.get('long_pct')}% / шорты {ls.get('short_pct')}%) — {ls.get('sentiment')}")

        nf = onchain.get("netflow", {})
        if nf:
            lines.append(f"- Активных адресов 24ч: {_fmt_large(nf.get('active_addresses_24h'))}")
            lines.append(f"- Транзакций 24ч: {_fmt_large(nf.get('tx_count_24h'))}")
            if nf.get("avg_fee_usd"):
                lines.append(f"- Средняя комиссия: ${nf['avg_fee_usd']:.2f}")
        lines.append("")

    # Новости
    if news_items:
        lines.append("## Последние новости (7 дней)")
        total_chars = 0
        for i, n in enumerate(news_items, 1):
            text = n.get("text") or n.get("snippet", "")
            if total_chars + len(text) > MAX_NEWS_CHARS:
                text = text[: max(0, MAX_NEWS_CHARS - total_chars)]
            lines.append(f"### [{i}] {n['title']}")
            lines.append(text)
            lines.append("")
            total_chars += len(text)
            if total_chars >= MAX_NEWS_CHARS:
                break

    lines.append("---")

    onchain_field = (
        '\n  "onchain_summary": "2-3 предложения: как on-chain данные (funding rate, LS ratio, активность сети) соотносятся с сигналом",'
        if onchain else ""
    )
    fund_field = (
        '\n  "fundamental_summary": "2-3 предложения: оценка мультипликаторов, рентабельности, долга и финансового здоровья компании",'
        if fundamentals else ""
    )
    lines.append(
        'Дай анализ строго в следующем формате JSON (только JSON, без лишнего текста):\n'
        '{\n'
        '  "verdict": "ПОДТВЕРЖДАЕТ" | "ПРОТИВОРЕЧИТ" | "НЕЙТРАЛЬНО",\n'
        '  "confidence": 1..5,\n'
        '  "news_summary": "2-3 предложения о ключевых новостях",'
        + fund_field
        + '\n  "cot_summary": "1-2 предложения о позиционировании (или null)",\n'
        '  "macro_summary": "1-2 предложения о макро/сентименте (или null)",'
        + onchain_field + '\n'
        '  "key_risks": ["риск 1", "риск 2", "риск 3"],\n'
        '  "key_catalysts": ["катализатор 1", "катализатор 2"],\n'
        '  "recommendation": "Краткий вывод 2-3 предложения"\n'
        '}'
    )
    return "\n".join(lines)


def _call_deepseek(prompt: str) -> dict:
    if not DEEPSEEK_API_KEY:
        raise ValueError("DEEPSEEK_API_KEY не задан в .env")

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": prompt},
        ],
        "temperature": 1,
        "max_tokens": 8000,
        "reasoning_effort": "low",
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    r = httpx.post(
        f"{DEEPSEEK_BASE}/v1/chat/completions",
        json=payload, headers=headers,
        timeout=60,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    return json.loads(content)


# ─── Публичный интерфейс ─────────────────────────────────────────────────────

def run_analysis(
    symbol: str,
    signal_direction: str = "UNKNOWN",
    signal_entry: Optional[float] = None,
    company_hint: str = "",
    asset_class: str = "stocks",
) -> dict:
    """
    Собирает все источники и возвращает финальный анализ.

    Returns:
        {
            "symbol", "signal_direction", "asset_class",
            "news": [...],
            "cot": {...} | null,
            "fear_greed": {...} | null,
            "verdict": {...},        ← от DeepSeek
            "errors": [...]          ← ненулевые только при частичных сбоях
        }
    """
    errors = []

    # 1. COT
    cot = None
    try:
        cot = fetch_cot(symbol)
    except Exception as e:
        errors.append(f"COT: {e}")

    # 2. Fear & Greed (только для крипто)
    fear_greed = None
    if asset_class == "crypto":
        try:
            fear_greed = fetch_fear_greed()
        except Exception as e:
            errors.append(f"F&G: {e}")

    # 3. On-Chain (только для крипто)
    onchain = None
    if asset_class == "crypto":
        try:
            onchain = fetch_onchain(symbol)
        except Exception as e:
            errors.append(f"OnChain: {e}")

    # 4. Фундаментальные данные (акции)
    fundamentals = None
    fundamentals_source = ""
    if asset_class == "stocks":
        if _is_ru_stock(symbol):
            try:
                fundamentals = fetch_ru_fundamentals(symbol)
                fundamentals_source = "T-Invest"
            except Exception as e:
                errors.append(f"RU Fundamentals: {e}")
        elif _is_us_stock(symbol):
            try:
                fundamentals = fetch_us_fundamentals(symbol)
                fundamentals_source = "Yahoo Finance / yfinance"
            except Exception as e:
                errors.append(f"US Fundamentals: {e}")

    # 5. Новости
    news_items = []
    try:
        news_items = fetch_news(symbol, company_hint)
    except Exception as e:
        errors.append(f"News: {e}")

    # 6. DeepSeek
    verdict = {}
    try:
        prompt = _build_prompt(
            symbol=symbol,
            signal_direction=signal_direction,
            signal_entry=signal_entry,
            news_items=news_items,
            cot=cot,
            fear_greed=fear_greed,
            onchain=onchain,
            fundamentals=fundamentals,
            fundamentals_source=fundamentals_source,
        )
        verdict = _call_deepseek(prompt)
    except Exception as e:
        errors.append(f"DeepSeek: {e}")
        verdict = {
            "verdict": "НЕЙТРАЛЬНО",
            "confidence": 1,
            "news_summary": "Не удалось получить анализ от AI.",
            "fundamental_summary": None,
            "cot_summary": None,
            "macro_summary": None,
            "onchain_summary": None,
            "key_risks": [],
            "key_catalysts": [],
            "recommendation": str(e),
        }

    news_out = [{"title": n["title"], "url": n["url"]} for n in news_items]

    return {
        "symbol": symbol.upper(),
        "signal_direction": signal_direction,
        "asset_class": asset_class,
        "analyzed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "news": news_out,
        "cot": cot,
        "fear_greed": fear_greed,
        "onchain": onchain,
        "fundamentals": fundamentals,
        "fundamentals_source": fundamentals_source,
        "verdict": verdict,
        "errors": errors,
    }
