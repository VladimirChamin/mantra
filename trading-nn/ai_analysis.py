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
DEEPSEEK_MODEL     = "deepseek-chat"

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
        "dateRestrict": "d7",    # за последние 7 дней
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


# ─── 4. DeepSeek синтез ───────────────────────────────────────────────────────

_SYSTEM_PROMPT = """Ты — опытный финансовый аналитик. Твоя задача — дать краткий,
структурированный фундаментальный анализ актива и сказать, подтверждает ли он
торговый сигнал нейронной сети. Отвечай строго по секциям. Будь конкретен,
избегай воды. Используй русский язык."""

def _build_prompt(
    symbol: str,
    signal_direction: str,
    signal_entry: Optional[float],
    news_items: list[dict],
    cot: Optional[dict],
    fear_greed: Optional[dict],
) -> str:
    lines = [f"## Актив: {symbol}"]
    lines.append(f"## Сигнал нейросети: {signal_direction}"
                 + (f" (вход ≈ {signal_entry})" if signal_entry else ""))
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
    lines.append("""Дай анализ строго в следующем формате JSON (только JSON, без лишнего текста):
{
  "verdict": "ПОДТВЕРЖДАЕТ" | "ПРОТИВОРЕЧИТ" | "НЕЙТРАЛЬНО",
  "confidence": 1..5,
  "news_summary": "2-3 предложения о ключевых новостях",
  "cot_summary": "1-2 предложения о позиционировании (или null)",
  "macro_summary": "1-2 предложения о макро/сентименте (или null)",
  "key_risks": ["риск 1", "риск 2", "риск 3"],
  "key_catalysts": ["катализатор 1", "катализатор 2"],
  "recommendation": "Краткий вывод 2-3 предложения"
}""")
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
        "temperature": 0.3,
        "max_tokens": 1200,
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

    # 2. Fear & Greed (только для крипто и общего рынка)
    fear_greed = None
    if asset_class in ("crypto",):
        try:
            fear_greed = fetch_fear_greed()
        except Exception as e:
            errors.append(f"F&G: {e}")

    # 3. Новости
    news_items = []
    try:
        news_items = fetch_news(symbol, company_hint)
    except Exception as e:
        errors.append(f"News: {e}")

    # 4. DeepSeek
    verdict = {}
    try:
        prompt = _build_prompt(
            symbol=symbol,
            signal_direction=signal_direction,
            signal_entry=signal_entry,
            news_items=news_items,
            cot=cot,
            fear_greed=fear_greed,
        )
        verdict = _call_deepseek(prompt)
    except Exception as e:
        errors.append(f"DeepSeek: {e}")
        verdict = {
            "verdict": "НЕЙТРАЛЬНО",
            "confidence": 1,
            "news_summary": "Не удалось получить анализ от AI.",
            "cot_summary": None,
            "macro_summary": None,
            "key_risks": [],
            "key_catalysts": [],
            "recommendation": str(e),
        }

    # новости в ответ — только заголовки + url (тексты большие)
    news_out = [{"title": n["title"], "url": n["url"]} for n in news_items]

    return {
        "symbol": symbol.upper(),
        "signal_direction": signal_direction,
        "asset_class": asset_class,
        "analyzed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "news": news_out,
        "cot": cot,
        "fear_greed": fear_greed,
        "verdict": verdict,
        "errors": errors,
    }
