"""
trading_nn.py
=============
Нейросеть (TensorFlow/Keras) для генерации торговых сигналов на финансовых рынках.

Что выдаёт система на инференсе:
    - direction : LONG / SHORT / FLAT (нет сделки)
    - entry     : цена входа
    - stop_loss : уровень стоп-лосса
    - take_profit: уровень тейк-профита
    - вероятность отработки + соотношение риск/прибыль (R:R)

Идея архитектуры (почему именно так — см. README):
    Модель НЕ угадывает три произвольных уровня цены напрямую. Это ненадёжно.
    Вместо этого модель решает вероятностную задачу (что хорошо умеют нейросети),
    выдавая три величины:
        p_up      — вероятность, что цена раньше дойдёт до тейка, чем до стопа (мет. Triple-Barrier)
        fwd_ret   — ожидаемая доходность на горизонте
        fwd_vol   — прогноз волатильности на горизонте
    А конкретные entry / SL / TP вычисляются детерминированно из прогноза
    волатильности (адаптивные уровни). Так уровни сами подстраиваются под рынок.

Режимы запуска (CLI):
    python trading_nn.py train    --symbol BTC-USD --interval 1h
    python trading_nn.py predict   --symbol BTC-USD --interval 1h
    python trading_nn.py retrain   --symbol BTC-USD --interval 1h   # дообучение по расписанию

ВАЖНО / ДИСКЛЕЙМЕР:
    Это образовательный инструмент. Он не гарантирует прибыль. Перед любым
    реальным использованием обязательны бэктест на out-of-sample, walk-forward
    валидация, учёт комиссий/проскальзывания и управление риском. Прошлые
    результаты модели не гарантируют будущих. Это не финансовая рекомендация.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, asdict, field
from datetime import datetime

import numpy as np
import pandas as pd
import joblib

from sklearn.preprocessing import StandardScaler
from volatility import add_vol_features

import tensorflow as tf
from tensorflow.keras import layers, Model, Input
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.regularizers import l2
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint

tf.get_logger().setLevel("ERROR")
np.random.seed(42)
tf.random.set_seed(42)


# =============================================================================
# 1. КОНФИГУРАЦИЯ
# =============================================================================
@dataclass
class Config:
    # --- данные ---
    symbol: str = ""
    interval: str = "1d"          # таймфрейм (D1 по умолчанию)
    period: str = "6y"            # сколько истории грузить
    # --- разметка целей (Triple-Barrier) ---
    horizon: int = 10             # горизонт прогноза в барах
    tp_atr_mult: float = 1.5      # тейк = entry +/- tp_atr_mult * ATR
    sl_atr_mult: float = 1.0      # стоп = entry -/+ sl_atr_mult * ATR
    # --- отложенный ордер (BUYSTOP / SELLSTOP) ---
    entry_offset_mult: float = 0.0  # BUYSTOP = close + offset*ATR, 0 = маркет
    fill_prob_threshold: float = 0.45  # мин. p_fill для выдачи сигнала
    # --- вход модели ---
    lookback: int = 32            # длина окна (timesteps) на вход сети
    # --- обучение ---
    val_fraction: float = 0.15    # доля валидации (хронологически последняя)
    epochs: int = 60
    batch_size: int = 128
    learning_rate: float = 1e-3
    # --- генерация сигнала на инференсе ---
    prob_threshold: float = 0.56  # минимальная p_up (или 1-p_up) для входа
    min_rr: float = 1.2           # минимальное R:R, иначе FLAT
    direction_filter: str = "both"  # "long" / "short" / "both"
    # --- сохранение ---
    model_dir: str = "models"
    feature_cols: list = field(default_factory=list)  # заполняется автоматически

    @property
    def tag(self) -> str:
        return f"{self.symbol}_{self.interval}".replace("/", "")


# Пресеты под таймфреймы Мосбиржи. Горизонт/окно/глубина истории подобраны
# с учётом числа баров в торговом дне (D1≈1, H4≈3, H1≈13 баров/день с вечеркой).
#
# Барьеры (tp/sl) подобраны так, чтобы за horizon баров они РЕАЛЬНО касались
# (barrier_hit_rate > 0.5), иначе p_up вырождается в знак шумной доходности и
# AUC залипает у 0.5. lookback уменьшен на D1 — мало истории, иначе переобучение.
TIMEFRAME_PRESETS = {
    "1d": dict(horizon=10, lookback=32, period="6y",
               tp_atr_mult=1.5, sl_atr_mult=1.0, prob_threshold=0.54,
               entry_offset_mult=0.0, fill_prob_threshold=0.45),
    "4h": dict(horizon=12, lookback=48, period="3y",
               tp_atr_mult=1.5, sl_atr_mult=1.0, prob_threshold=0.55,
               entry_offset_mult=0.0, fill_prob_threshold=0.45),
    "1h": dict(horizon=24, lookback=64, period="2y",
               tp_atr_mult=1.5, sl_atr_mult=1.0, prob_threshold=0.56,
               entry_offset_mult=0.0, fill_prob_threshold=0.45),
}

# Ликвидные инструменты Мосбиржи (подсказки для интерфейса; можно ввести любой тикер).
MOEX_INSTRUMENTS = [
    # Индексы
    {"ticker": "IMOEX",   "name": "Индекс Мосбиржи",    "kind": "index"},
    {"ticker": "RTSI",    "name": "Индекс РТС",          "kind": "index"},
    # Акции МБ
    {"ticker": "SBER",    "name": "Сбербанк",            "kind": "share"},
    {"ticker": "GAZP",    "name": "Газпром",             "kind": "share"},
    {"ticker": "LKOH",    "name": "Лукойл",              "kind": "share"},
    {"ticker": "GMKN",    "name": "Норникель",           "kind": "share"},
    {"ticker": "ROSN",    "name": "Роснефть",            "kind": "share"},
    {"ticker": "NVTK",    "name": "Новатэк",             "kind": "share"},
    {"ticker": "TATN",    "name": "Татнефть",            "kind": "share"},
    {"ticker": "MGNT",    "name": "Магнит",              "kind": "share"},
    {"ticker": "MTSS",    "name": "МТС",                 "kind": "share"},
    {"ticker": "ALRS",    "name": "Алроса",              "kind": "share"},
    {"ticker": "CHMF",    "name": "Северсталь",          "kind": "share"},
    {"ticker": "PLZL",    "name": "Полюс",               "kind": "share"},
    {"ticker": "SNGS",    "name": "Сургутнефтегаз",      "kind": "share"},
    {"ticker": "VTBR",    "name": "ВТБ",                 "kind": "share"},
    {"ticker": "MOEX",    "name": "Московская биржа",    "kind": "share"},
    {"ticker": "PHOR",    "name": "ФосАгро",             "kind": "share"},
    {"ticker": "RUAL",    "name": "Русал",               "kind": "share"},
    {"ticker": "YDEX",    "name": "Яндекс",              "kind": "share"},
    # Крипта
    {"ticker": "BTCUSDT", "name": "Bitcoin",             "kind": "crypto"},
    {"ticker": "ETHUSDT", "name": "Ethereum",            "kind": "crypto"},
    {"ticker": "SOLUSDT", "name": "Solana",              "kind": "crypto"},
    {"ticker": "BNBUSDT", "name": "BNB",                 "kind": "crypto"},
    {"ticker": "XRPUSDT", "name": "XRP",                 "kind": "crypto"},
    {"ticker": "ADAUSDT", "name": "Cardano",             "kind": "crypto"},
    {"ticker": "DOGEUSDT","name": "Dogecoin",            "kind": "crypto"},
    {"ticker": "AVAXUSDT","name": "Avalanche",           "kind": "crypto"},
    {"ticker": "DOTUSDT", "name": "Polkadot",            "kind": "crypto"},
    {"ticker": "LINKUSDT","name": "Chainlink",           "kind": "crypto"},
    # Форекс
    {"ticker": "EURUSD",  "name": "Евро / Доллар",      "kind": "forex"},
    {"ticker": "GBPUSD",  "name": "Фунт / Доллар",      "kind": "forex"},
    {"ticker": "USDJPY",  "name": "Доллар / Иена",      "kind": "forex"},
    {"ticker": "USDRUB",  "name": "Доллар / Рубль",     "kind": "forex"},
    {"ticker": "USDCNY",  "name": "Доллар / Юань",      "kind": "forex"},
    {"ticker": "EURRUB",  "name": "Евро / Рубль",       "kind": "forex"},
    # Товары
    {"ticker": "XAUUSD",  "name": "Золото",              "kind": "commodity"},
    {"ticker": "XAGUSD",  "name": "Серебро",             "kind": "commodity"},
    {"ticker": "BRENT",   "name": "Нефть Brent",         "kind": "commodity"},
    {"ticker": "CL",      "name": "Нефть WTI",           "kind": "commodity"},
    {"ticker": "NG",      "name": "Природный газ",       "kind": "commodity"},
    {"ticker": "ZC",      "name": "Кукуруза",            "kind": "commodity"},
    {"ticker": "ZW",      "name": "Пшеница",             "kind": "commodity"},
    {"ticker": "ZS",      "name": "Соя",                 "kind": "commodity"},
]


# Окна walk-forward по таймфреймам (train_bars, test_bars). Учитывают, что
# на D1 баров мало (~250/год), а на H1 — много.
BACKTEST_PRESETS = {
    "1d": {"train_bars": 700,  "test_bars": 120},
    "4h": {"train_bars": 1500, "test_bars": 300},
    "1h": {"train_bars": 4000, "test_bars": 700},
}


def timeframe_preset(interval: str) -> dict:
    """Возвращает пресет параметров под таймфрейм (или пустой dict)."""
    return dict(TIMEFRAME_PRESETS.get(interval, {}))


def make_config(symbol: str, interval: str, **overrides) -> Config:
    """Строит Config из пресета таймфрейма, применяя явные переопределения сверху."""
    params = timeframe_preset(interval)
    params.update({"symbol": symbol, "interval": interval})
    params.update({k: v for k, v in overrides.items() if v is not None})
    return Config(**params)


# =============================================================================
# РЕЕСТР КЛАССОВ АКТИВОВ
# =============================================================================

# Словарь тикер → класс. Если тикер не найден — используется автодетект.
ASSET_CLASS_REGISTRY: dict[str, str] = {
    # Акции Мосбиржи
    "SBER": "stocks", "GAZP": "stocks", "LKOH": "stocks", "GMKN": "stocks",
    "ROSN": "stocks", "NVTK": "stocks", "TATN": "stocks", "MGNT": "stocks",
    "MTSS": "stocks", "ALRS": "stocks", "CHMF": "stocks", "PLZL": "stocks",
    "SNGS": "stocks", "VTBR": "stocks", "MOEX": "stocks", "PHOR": "stocks",
    "RUAL": "stocks", "YDEX": "stocks", "IMOEX": "stocks", "RTSI": "stocks",
    # Крипта (Bybit / любая биржа)
    "BTCUSDT": "crypto", "ETHUSDT": "crypto", "SOLUSDT": "crypto",
    "BNBUSDT": "crypto", "XRPUSDT": "crypto", "ADAUSDT": "crypto",
    "DOGEUSDT": "crypto", "AVAXUSDT": "crypto", "DOTUSDT": "crypto",
    "MATICUSDT": "crypto", "LINKUSDT": "crypto", "UNIUSDT": "crypto",
    # Облигации (ISIN-коды или тикеры)
    "SU26238RMFS4": "bonds", "SU26240RMFS0": "bonds", "SU26233RMFS5": "bonds",
    "SU26236RMFS8": "bonds", "SU26241RMFS8": "bonds",
    # Forex
    "EURUSD": "forex", "USDRUB": "forex", "GBPUSD": "forex",
    "USDJPY": "forex", "USDCNY": "forex", "EURRUB": "forex",
    # Commodity — металлы
    "XAUUSD": "commodity", "GOLD": "commodity", "XAGUSD": "commodity",
    "SILVER": "commodity", "COPPER": "commodity", "PLATINUM": "commodity",
    "HG": "commodity", "GC": "commodity", "SI": "commodity",
    # Commodity — энергоносители
    "CL": "commodity", "CRUDE": "commodity", "BRENT": "commodity",
    "NG": "commodity", "WTI": "commodity", "UKOIL": "commodity",
    "GAZR": "commodity",
    # Commodity — с/х продукция
    "ZC": "commodity", "ZW": "commodity", "ZS": "commodity",
    "KC": "commodity", "SB": "commodity", "CC": "commodity",
    "WHEAT": "commodity", "CORN": "commodity", "SOYA": "commodity",
}

# Описания классов для UI
ASSET_CLASS_META = {
    "stocks": {
        "label": "Акции",
        "description": "Акции Мосбиржи и мировых бирж",
        "default_symbols": ["SBER", "GAZP", "LKOH", "GMKN", "ROSN",
                            "NVTK", "TATN", "MGNT", "YDEX", "MOEX"],
    },
    "crypto": {
        "label": "Крипта",
        "description": "Криптовалютные пары (Bybit, Binance)",
        "default_symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
                            "XRPUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT"],
    },
    "bonds": {
        "label": "Облигации",
        "description": "ОФЗ и корпоративные облигации",
        "default_symbols": ["SU26238RMFS4", "SU26240RMFS0", "SU26233RMFS5",
                            "SU26236RMFS8", "SU26241RMFS8"],
    },
    "forex": {
        "label": "Forex",
        "description": "Валютные пары",
        "default_symbols": ["EURUSD", "GBPUSD", "USDJPY", "USDRUB", "EURRUB", "USDCNY"],
    },
    "commodity": {
        "label": "Commodity",
        "description": "Металлы, энергоносители, с/х продукция",
        "default_symbols": ["XAUUSD", "XAGUSD", "CL", "NG", "BRENT", "ZC", "ZW", "ZS"],
    },
}


def detect_asset_class(symbol: str) -> str:
    """
    Определяет класс актива по тикеру.
    Сначала проверяет реестр, затем пробует автодетект по паттернам.
    """
    sym = symbol.upper().strip()

    # явная регистрация
    if sym in ASSET_CLASS_REGISTRY:
        return ASSET_CLASS_REGISTRY[sym]

    # автодетект по суффиксам крипты
    if sym.endswith("USDT") or sym.endswith("BTC") or sym.endswith("ETH"):
        return "crypto"

    # автодетект облигаций по ISIN
    if len(sym) == 12 and sym[:2].isalpha() and sym[2:].isdigit():
        return "bonds"

    # автодетект форекс по длине и известным валютам
    if len(sym) == 6 and sym.isalpha():
        return "forex"

    # дефолт — акции
    return "stocks"


def register_asset(symbol: str, asset_class: str):
    """Добавляет тикер в реестр классов активов."""
    if asset_class not in ASSET_CLASS_META:
        raise ValueError(f"Неизвестный класс '{asset_class}'. "
                         f"Доступно: {', '.join(ASSET_CLASS_META)}")
    ASSET_CLASS_REGISTRY[symbol.upper()] = asset_class


def class_model_tag(asset_class: str, interval: str) -> str:
    """Формирует тег модели для класса активов: CLASS_interval."""
    return f"{asset_class.upper()}_{interval}"


def resolve_model_tag(symbol: str, interval: str, model_dir: str = "models",
                      active_tags: list[str] | None = None) -> str:
    """
    Определяет какую модель использовать для данного тикера:
    1. Индивидуальная модель (SBER_1d)     — наивысший приоритет
    2. Модель класса активов (STOCKS_1d)   — если обучена
    3. Универсальная модель (UNIVERSAL_1d) — fallback
    active_tags — если задан (непустой), только модели из этого списка считаются доступными.
    Выбрасывает FileNotFoundError если ни одна не найдена.
    """
    candidates = [
        f"{symbol.upper()}_{interval}",                        # индивидуальная
        class_model_tag(detect_asset_class(symbol), interval), # класс активов
        f"UNIVERSAL_{interval}",                               # универсальная
    ]
    for tag in candidates:
        path = os.path.join(model_dir, f"{tag}_model.keras")
        if not os.path.exists(path):
            continue
        # если задан список активных — тег должен быть в нём
        if active_tags and tag not in active_tags:
            continue
        return tag
    raise FileNotFoundError(
        f"Модель не найдена для '{symbol}' ({interval}). "
        f"Проверено: {', '.join(candidates)}. "
        "Обучите модель или активируйте нужную в разделе «Нейросети»."
    )


# =============================================================================
# 2. ДАННЫЕ: загрузка + фичи + разметка целей
# =============================================================================
# Хук для подмены источника данных.
# При старте автоматически активируется T-Invest если есть TINVEST_TOKEN в env.
_DATA_SOURCE = None


def set_data_source(fn):
    """Регистрирует свой загрузчик данных: fn(cfg) -> DataFrame[open,high,low,close,volume]."""
    global _DATA_SOURCE
    _DATA_SOURCE = fn


def _auto_init_datasource():
    """Автоматически подключает T-Invest если токен есть в окружении."""
    import os
    token = os.environ.get("TINVEST_TOKEN", "").strip()
    if token and _DATA_SOURCE is None:
        try:
            from tinvest_loader import make_loader
            set_data_source(make_loader(token))
            print("[data] T-Invest подключён автоматически (токен из TINVEST_TOKEN)")
        except Exception as e:
            print(f"[data] Не удалось подключить T-Invest автоматически: {e}")


_auto_init_datasource()


def load_ohlcv(cfg: Config) -> pd.DataFrame:
    """Грузит OHLCV через зарегистрированный источник данных."""
    if _DATA_SOURCE is not None:
        df = _DATA_SOURCE(cfg)
        print(f"[data] Загружено {len(df)} баров {cfg.symbol} {cfg.interval}")
        return df
    raise RuntimeError(
        f"Источник данных не настроен. "
        "Добавьте TINVEST_TOKEN в .env или выберите источник в интерфейсе."
    )


# Индексы для расчёта relative strength по классу активов
_INDEX_BY_CLASS = {
    "stocks": "IMOEX",
    "crypto": "BTCUSDT",
}


def _try_load_index(symbol: str, interval: str) -> pd.DataFrame | None:
    """Пытается загрузить индекс для расчёта relative strength. Не бросает исключений."""
    if symbol.upper() in ("IMOEX", "RTSI", "BTCUSDT"):
        return None  # не считаем RS для самого индекса
    asset_class = detect_asset_class(symbol)
    index_sym = _INDEX_BY_CLASS.get(asset_class)
    if not index_sym or index_sym == symbol.upper():
        return None
    try:
        cfg_idx = make_config(index_sym, interval)
        return load_ohlcv(cfg_idx)
    except Exception as e:
        print(f"[features] Не удалось загрузить индекс {index_sym}: {e}")
        return None


def _try_load_htf(cfg: Config) -> pd.DataFrame | None:
    """Загружает данные и строит HTF-агрегацию. Не бросает исключений."""
    _htf_map = {"1h": "4h", "4h": "1d", "1d": "1w"}
    if cfg.interval not in _htf_map:
        return None
    try:
        # Загружаем те же данные основного инструмента — агрегируем сами
        df = load_ohlcv(cfg)
        return _make_htf_summary(df, cfg.interval)
    except Exception as e:
        print(f"[features] HTF контекст недоступен: {e}")
        return None


def _synthetic_ohlcv(n: int = 6000) -> pd.DataFrame:
    """Геометрическое блуждание с режимами тренда/флэта — чтобы код был запускаем без сети."""
    rng = np.random.default_rng(7)
    ret = np.zeros(n)
    regime = 0.0
    for i in range(n):
        if rng.random() < 0.01:
            regime = rng.normal(0, 0.0004)          # смена режима тренда
        ret[i] = regime + rng.normal(0, 0.006)      # дрейф + шум
    close = 30000 * np.exp(np.cumsum(ret))
    high = close * (1 + np.abs(rng.normal(0, 0.003, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.003, n)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    vol = rng.lognormal(10, 0.5, n)
    idx = pd.date_range("2022-01-01", periods=n, freq="h")
    return pd.DataFrame({"open": open_, "high": high, "low": low,
                         "close": close, "volume": vol}, index=idx)


def add_features(df: pd.DataFrame, interval: str = "1d",
                 index_df: pd.DataFrame | None = None,
                 htf_df: pd.DataFrame | None = None,
                 ltf_df: pd.DataFrame | None = None) -> pd.DataFrame:
    """
    Технические индикаторы + GARCH/HAR-RV + календарные признаки.
    Все используют ТОЛЬКО прошлые данные (нет утечки).

    index_df — DataFrame с данными индекса (IMOEX/BTC.D) для relative strength.
    htf_df   — агрегированные фичи старшего таймфрейма (например H4 для D1).
    ltf_df   — агрегированные фичи младшего таймфрейма (не используется сейчас).
    """
    out = df.copy()
    c, h, l, v = out["close"], out["high"], out["low"], out["volume"]

    # ── доходности ─────────────────────────────────────────────────────────────
    out["ret_1"]  = c.pct_change()
    out["ret_5"]  = c.pct_change(5)
    out["ret_10"] = c.pct_change(10)

    # ── скользящие средние и отклонения ────────────────────────────────────────
    for w in (10, 20, 50):
        out[f"sma_{w}"]  = c.rolling(w).mean() / c - 1
        out[f"std_{w}"]  = c.pct_change().rolling(w).std()

    # ── EMA ────────────────────────────────────────────────────────────────────
    out["ema_12"] = c.ewm(span=12).mean() / c - 1
    out["ema_26"] = c.ewm(span=26).mean() / c - 1

    # ── MACD ───────────────────────────────────────────────────────────────────
    macd = c.ewm(span=12).mean() - c.ewm(span=26).mean()
    out["macd"]     = macd / c
    out["macd_sig"] = macd.ewm(span=9).mean() / c

    # ── RSI(14) ────────────────────────────────────────────────────────────────
    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / (loss + 1e-9)
    out["rsi"] = 100 - 100 / (1 + rs)

    # ── Stochastic RSI(14,3,3) ─────────────────────────────────────────────────
    rsi_s      = out["rsi"]
    rsi_min14  = rsi_s.rolling(14).min()
    rsi_max14  = rsi_s.rolling(14).max()
    stoch_rsi_k = (rsi_s - rsi_min14) / (rsi_max14 - rsi_min14 + 1e-9)
    out["stoch_rsi_k"] = stoch_rsi_k.rolling(3).mean()          # %K сглаженный
    out["stoch_rsi_d"] = out["stoch_rsi_k"].rolling(3).mean()   # %D (сигнальная)

    # ── Williams %R(14) ────────────────────────────────────────────────────────
    hh14 = h.rolling(14).max()
    ll14 = l.rolling(14).min()
    out["williams_r"] = (hh14 - c) / (hh14 - ll14 + 1e-9) * -100   # [-100, 0]

    # ── ATR(14) ────────────────────────────────────────────────────────────────
    tr       = pd.concat([(h - l), (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr      = tr.rolling(14).mean()
    out["atr"]      = atr        # абсолютный — для барьеров
    out["atr_norm"] = atr / c    # нормированный — как фича

    # ── Bollinger %B ───────────────────────────────────────────────────────────
    mid = c.rolling(20).mean()
    sd  = c.rolling(20).std()
    out["boll_b"] = (c - (mid - 2 * sd)) / (4 * sd + 1e-9)

    # ── Donchian Channel(20): позиция цены в канале ────────────────────────────
    don_h20 = h.rolling(20).max()
    don_l20 = l.rolling(20).min()
    out["donchian_pos"]   = (c - don_l20) / (don_h20 - don_l20 + 1e-9)   # [0,1]
    out["donchian_width"] = (don_h20 - don_l20) / (c + 1e-9)              # ширина канала / цена

    # ── Close position in bar ──────────────────────────────────────────────────
    out["close_pos"] = (c - l) / (h - l + 1e-9)   # [0,1]: 0=закрылись у низа, 1=у верха

    # ── объёмные фичи ──────────────────────────────────────────────────────────
    out["vol_chg"] = v.pct_change()
    out["vol_z"]   = (v - v.rolling(20).mean()) / (v.rolling(20).std() + 1e-9)

    # ── OBV (On-Balance Volume) ────────────────────────────────────────────────
    obv = (np.sign(c.diff()) * v).fillna(0).cumsum()
    out["obv_z"] = (obv - obv.rolling(20).mean()) / (obv.rolling(20).std() + 1e-9)
    out["obv_slope"] = obv.diff(5) / (obv.abs().rolling(5).mean() + 1e-9)

    # ── GARCH/HAR-RV фичи ──────────────────────────────────────────────────────
    out = add_vol_features(out, interval=interval)

    # ── Календарные признаки ───────────────────────────────────────────────────
    out = _add_calendar_features(out, interval=interval)

    # ── Relative Strength (акция / индекс) ────────────────────────────────────
    if index_df is not None:
        out = _add_relative_strength(out, index_df)

    # ── Мультитаймфрейм: контекст старшего ТФ ─────────────────────────────────
    if htf_df is not None:
        out = _merge_htf_features(out, htf_df, prefix="htf_")

    return out


# ── Вспомогательные функции для новых признаков ──────────────────────────────

def _add_calendar_features(df: pd.DataFrame, interval: str = "1d") -> pd.DataFrame:
    """
    Циклически закодированные календарные признаки (sin/cos кодирование
    позволяет модели видеть близость понедельника к воскресенью и т.д.)
    """
    idx = df.index
    out = df.copy()

    if not isinstance(idx, pd.DatetimeIndex):
        try:
            idx = pd.to_datetime(idx)
        except Exception:
            return out

    dow   = idx.dayofweek           # 0=пн … 6=вс
    month = idx.month               # 1..12

    # день недели (цикл 7)
    out["cal_dow_sin"]   = np.sin(2 * np.pi * dow / 7)
    out["cal_dow_cos"]   = np.cos(2 * np.pi * dow / 7)

    # месяц (цикл 12)
    out["cal_month_sin"] = np.sin(2 * np.pi * (month - 1) / 12)
    out["cal_month_cos"] = np.cos(2 * np.pi * (month - 1) / 12)

    # близость к выходным: пятница=1, понедельник=0.75, среда=0
    _prox = {0: 0.75, 1: 0.25, 2: 0.0, 3: 0.25, 4: 1.0, 5: 0.5, 6: 0.5}
    out["cal_weekend_prox"] = dow.map(_prox).fillna(0.0).values

    # только для внутридневных таймфреймов добавляем час
    if interval in ("1h", "4h", "30m", "15m"):
        hour = pd.Series(idx.hour, index=df.index)
        out["cal_hour_sin"] = np.sin(2 * np.pi * hour / 24)
        out["cal_hour_cos"] = np.cos(2 * np.pi * hour / 24)
        # торговая сессия Мосбиржи 10:00-23:50 → нормированная позиция внутри дня
        session_start, session_end = 10, 23
        session_len = session_end - session_start
        out["cal_session_pos"] = ((hour - session_start) / session_len).clip(0, 1)

    return out


def _add_relative_strength(df: pd.DataFrame, index_df: pd.DataFrame,
                            window: int = 20) -> pd.DataFrame:
    """
    Относительная сила: RS = (актив_ret - индекс_ret) / (σ_индекс + 1e-9)
    Выравниваем индекс по индексу основного датафрейма.
    """
    out = df.copy()
    try:
        idx_close = index_df["close"].reindex(df.index, method="ffill")
        asset_ret = out["close"].pct_change()
        index_ret = idx_close.pct_change()

        rs_raw = asset_ret - index_ret
        out["rs_raw"]  = rs_raw
        out["rs_z"]    = (rs_raw - rs_raw.rolling(window).mean()) / (rs_raw.rolling(window).std() + 1e-9)
        out["rs_ratio"] = (out["close"] / out["close"].iloc[0]) / (idx_close / idx_close.iloc[0] + 1e-9) - 1

        # бета (скользящая ковариация / дисперсия индекса)
        cov  = asset_ret.rolling(window).cov(index_ret)
        var  = index_ret.rolling(window).var()
        out["rs_beta"] = cov / (var + 1e-9)
    except Exception as e:
        print(f"[features] Relative strength error: {e}")
    return out


def _make_htf_summary(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    """
    Агрегирует OHLCV-данные в старший таймфрейм и считает базовые индикаторы.
    D1 → W1: resample по неделям.
    H4 → D1: resample по дням.
    H1 → H4: resample по 4h.
    Возвращает DataFrame с теми же датами, что и df (forward-fill).
    """
    _resample_map = {
        "1h":  {"htf": "4h",  "rule": "4h"},
        "4h":  {"htf": "1d",  "rule": "D"},
        "1d":  {"htf": "1w",  "rule": "W"},
    }
    rule_info = _resample_map.get(interval)
    if rule_info is None:
        return pd.DataFrame(index=df.index)

    rule = rule_info["rule"]
    agg = df[["open", "high", "low", "close", "volume"]].resample(rule).agg({
        "open":   "first",
        "high":   "max",
        "low":    "min",
        "close":  "last",
        "volume": "sum",
    }).dropna()

    if len(agg) < 5:
        return pd.DataFrame(index=df.index)

    c = agg["close"]
    htf = pd.DataFrame(index=agg.index)
    htf["htf_ret_1"]    = c.pct_change()
    htf["htf_sma_10"]   = c.rolling(10).mean() / c - 1
    htf["htf_sma_20"]   = c.rolling(20).mean() / c - 1

    delta = c.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    htf["htf_rsi"]      = 100 - 100 / (1 + gain / (loss + 1e-9))

    macd_ = c.ewm(span=12).mean() - c.ewm(span=26).mean()
    htf["htf_macd"]     = macd_ / c
    htf["htf_vol_z"]    = (
        agg["volume"].pct_change().rolling(10)
        .apply(lambda x: (x[-1] - x[:-1].mean()) / (x[:-1].std() + 1e-9) if len(x) > 1 else 0, raw=True)
    )

    # forward-fill на индекс основного ТФ (значение недели/дня держится до следующего)
    htf_ff = htf.reindex(df.index, method="ffill")
    return htf_ff


def _merge_htf_features(df: pd.DataFrame, htf_df: pd.DataFrame,
                        prefix: str = "htf_") -> pd.DataFrame:
    """Подклеивает колонки htf_df к df, переименовывая с префиксом."""
    out = df.copy()
    for col in htf_df.columns:
        col_name = col if col.startswith(prefix) else f"{prefix}{col}"
        out[col_name] = htf_df[col].values if len(htf_df) == len(df) else htf_df[col].reindex(df.index, method="ffill")
    return out


def triple_barrier_targets(df: pd.DataFrame, cfg: Config):
    """
    Метод тройного барьера с поддержкой отложенных ордеров BUYSTOP/SELLSTOP.

    Логика (при entry_offset_mult > 0):
      - LONG: ордер BUYSTOP = close + offset*ATR. Сначала ждём касания ордера
        (high >= buystop). Если за horizon баров цена не дошла — отмена (p_fill=0).
        Если ордер сработал — запускаем тройной барьер от цены срабатывания.
      - SHORT: SELLSTOP = close - offset*ATR, аналогично (low <= sellstop).
      - При entry_offset_mult == 0: поведение как раньше (маркет-вход по close).

    Возвращает:
        p_up    — 1 если TP достигнут (при условии что ордер сработал), иначе 0
        fwd_ret — доходность от фактической цены входа до бара закрытия горизонта
        fwd_vol — реализованная волатильность на горизонте
        p_fill  — 1 если ордер сработал в течение horizon, 0 если отменён
        valid   — маска валидных точек
        barrier_hit — маска точек, где метку дал РЕАЛЬНЫЙ барьер (TP/SL коснулись
                      за horizon), а не fallback по знаку доходности. Доля таких
                      точек (barrier_hit_rate) — ключевой индикатор качества меток:
                      если она низкая, p_up ≈ знак шумной H-барной доходности и
                      AUC обречён колебаться около 0.5.
    """
    close = df["close"].to_numpy()
    high  = df["high"].to_numpy()
    low   = df["low"].to_numpy()
    atr   = df["atr"].to_numpy()
    ret1  = df["close"].pct_change().to_numpy()
    n = len(df)
    H = cfg.horizon
    offset = cfg.entry_offset_mult  # 0 = маркет

    p_up    = np.zeros(n, dtype=np.float32)
    fwd_ret = np.zeros(n, dtype=np.float32)
    fwd_vol = np.zeros(n, dtype=np.float32)
    p_fill  = np.zeros(n, dtype=np.float32)
    valid   = np.zeros(n, dtype=bool)
    barrier_hit = np.zeros(n, dtype=bool)

    for i in range(n - H):
        a = atr[i]
        if not np.isfinite(a) or a <= 0:
            continue

        base_price = close[i]
        vol = np.nanstd(ret1[i + 1: i + H + 1])

        if offset == 0:
            # ── Маркет-вход (оригинальная логика) ────────────────────────────
            # Считаем для обоих направлений усреднённо — модель сама выберет.
            # p_fill = 1 всегда (вход гарантирован).
            entry = base_price
            tp = entry + cfg.tp_atr_mult * a
            sl = entry - cfg.sl_atr_mult * a
            outcome = None
            for j in range(1, H + 1):
                if high[i + j] >= tp:
                    outcome = 1; break
                if low[i + j] <= sl:
                    outcome = 0; break
            barrier_hit[i] = outcome is not None   # метку дал реальный барьер?
            if outcome is None:
                outcome = 1 if close[i + H] > entry else 0
            p_up[i]    = outcome
            fwd_ret[i] = (close[i + H] - entry) / entry
            fwd_vol[i] = vol
            p_fill[i]  = 1.0
            valid[i]   = True

        else:
            # ── Отложенный ордер: симулируем оба направления, берём лучшее ───
            # LONG (BUYSTOP): ордер срабатывает когда high >= buystop_level
            buystop  = base_price + offset * a
            sellstop = base_price - offset * a

            # --- LONG ---
            long_fill_bar = None
            for j in range(1, H + 1):
                if high[i + j] >= buystop:
                    long_fill_bar = j
                    break

            long_outcome = 0.0
            long_ret     = 0.0
            long_filled  = 0.0
            long_hit     = False
            if long_fill_bar is not None:
                long_filled = 1.0
                entry_l = buystop
                tp_l = entry_l + cfg.tp_atr_mult * a
                sl_l = entry_l - cfg.sl_atr_mult * a
                remaining = H - long_fill_bar
                outcome_l = None
                for k in range(1, remaining + 1):
                    jj = i + long_fill_bar + k
                    if jj >= n: break
                    if high[jj] >= tp_l: outcome_l = 1; break
                    if low[jj]  <= sl_l: outcome_l = 0; break
                long_hit = outcome_l is not None
                if outcome_l is None:
                    end_bar = min(i + H, n - 1)
                    outcome_l = 1 if close[end_bar] > entry_l else 0
                long_outcome = float(outcome_l)
                long_ret     = (close[min(i + H, n - 1)] - entry_l) / entry_l

            # --- SHORT ---
            short_fill_bar = None
            for j in range(1, H + 1):
                if low[i + j] <= sellstop:
                    short_fill_bar = j
                    break

            short_outcome = 0.0
            short_ret     = 0.0
            short_filled  = 0.0
            short_hit     = False
            if short_fill_bar is not None:
                short_filled = 1.0
                entry_s = sellstop
                tp_s = entry_s - cfg.tp_atr_mult * a
                sl_s = entry_s + cfg.sl_atr_mult * a
                remaining = H - short_fill_bar
                outcome_s = None
                for k in range(1, remaining + 1):
                    jj = i + short_fill_bar + k
                    if jj >= n: break
                    if low[jj]  <= tp_s: outcome_s = 1; break
                    if high[jj] >= sl_s: outcome_s = 0; break
                short_hit = outcome_s is not None
                if outcome_s is None:
                    end_bar = min(i + H, n - 1)
                    outcome_s = 1 if close[end_bar] < entry_s else 0
                short_outcome = float(outcome_s)
                short_ret     = (entry_s - close[min(i + H, n - 1)]) / entry_s

            # p_fill = среднее вероятностей срабатывания (обоих направлений)
            # p_up   = взвешенный итог: сколько из сработавших сделок прибыльны
            filled_any = long_filled + short_filled
            p_fill[i]  = min(filled_any, 1.0)   # 1 если хоть одно сработало

            if filled_any > 0:
                # p_up: доля прибыльных среди сработавших сделок
                profit_sum = long_filled * long_outcome + short_filled * short_outcome
                p_up[i]    = profit_sum / filled_any
                # fwd_ret: взвешенная доходность
                fwd_ret[i] = (long_filled * long_ret + short_filled * short_ret) / filled_any
            else:
                # оба ордера отменены: p_up = нейтральный (0.5), ret = 0
                p_up[i]    = 0.5
                fwd_ret[i] = 0.0

            barrier_hit[i] = long_hit or short_hit   # хоть одно направление дошло до барьера
            fwd_vol[i] = vol
            valid[i]   = True

    return p_up, fwd_ret, fwd_vol, p_fill, valid, barrier_hit


# =============================================================================
# 3. ПОДГОТОВКА ВЫБОРКИ: масштабирование + построение последовательностей
# =============================================================================
def build_dataset(df: pd.DataFrame, cfg: Config, scaler: StandardScaler | None = None,
                  fit_scaler: bool = True,
                  index_df: pd.DataFrame | None = None,
                  htf_df: pd.DataFrame | None = None):
    """
    Готовит X (окна), y (3 цели) и метаданные. Масштабирование делается
    по train-части (без утечки), если scaler не передан.

    index_df — данные индекса для relative strength (опционально).
    htf_df   — агрегированные HTF-фичи (опционально).
    """
    feats = add_features(df, interval=cfg.interval,
                         index_df=index_df, htf_df=htf_df)
    p_up, fwd_ret, fwd_vol, p_fill, valid, barrier_hit = triple_barrier_targets(feats, cfg)

    # выбираем фичи (исключаем сырые цены/объём и абсолютный ATR)
    exclude = {"open", "high", "low", "close", "volume", "atr"}
    feature_cols = [c for c in feats.columns if c not in exclude]
    cfg.feature_cols = feature_cols

    feats = feats.replace([np.inf, -np.inf], np.nan)
    X_raw = feats[feature_cols].to_numpy(dtype=np.float32)

    # строки валидны, если есть все фичи И есть полная разметка цели
    finite = np.isfinite(X_raw).all(axis=1)
    row_ok = finite & valid

    # хронологический сплит train/val по доле
    n = len(df)
    split = int(n * (1 - cfg.val_fraction))

    # scaler учим ТОЛЬКО на train-строках
    if scaler is None:
        scaler = StandardScaler()
        train_mask = row_ok.copy()
        train_mask[split:] = False
        scaler.fit(X_raw[train_mask])
    X_scaled = scaler.transform(np.nan_to_num(X_raw))

    L = cfg.lookback
    Xs, yp, yr, yv, yf, end_idx = [], [], [], [], [], []
    for t in range(L - 1, n):
        if not row_ok[t]:
            continue
        window = X_scaled[t - L + 1: t + 1]
        if not np.isfinite(window).all():
            continue
        Xs.append(window)
        yp.append(p_up[t]); yr.append(fwd_ret[t])
        yv.append(fwd_vol[t]); yf.append(p_fill[t])
        end_idx.append(t)

    Xs = np.asarray(Xs, dtype=np.float32)
    yp = np.asarray(yp, dtype=np.float32)
    yr = np.asarray(yr, dtype=np.float32)
    yv = np.asarray(yv, dtype=np.float32)
    yf = np.asarray(yf, dtype=np.float32)
    end_idx = np.asarray(end_idx)

    is_train = end_idx < split
    # доля меток, заданных реальным касанием барьера (а не fallback по знаку).
    # Низкое значение → метки шумные, AUC не выйдет за 0.5.
    barrier_hit_rate = float(barrier_hit[end_idx].mean()) if len(end_idx) else 0.0
    data = {
        "X": Xs, "p_up": yp, "fwd_ret": yr, "fwd_vol": yv, "p_fill": yf,
        "is_train": is_train, "end_idx": end_idx,
        "feature_cols": feature_cols,
        "barrier_hit_rate": barrier_hit_rate,
    }
    return data, scaler


# =============================================================================
# 4. МОДЕЛЬ BiLSTM + CNN + Multi-Head Attention
#
# Архитектура:
#   1. CNN-блок: три параллельных Conv1D (kernel 3/5/7) захватывают локальные
#      паттерны разного масштаба, затем конкатенируются.
#   2. BiLSTM: двунаправленный LSTM читает последовательность в обе стороны,
#      даёт модели «контекст будущего» внутри окна.
#   3. Multi-Head Attention: self-attention поверх BiLSTM-выходов — модель
#      сама учится взвешивать важные временны́е шаги (пробои, дивергенции и т.п.)
#   4. Три параллельные выходные головы — интерфейс идентичен старой GRU-модели.
# =============================================================================

class LastStep(layers.Layer):
    """Извлекает последний временной шаг (T, D) -> (D,).
    Кастомный слой вместо Lambda — безопасно сериализуется в Keras 3."""
    def call(self, x):
        return x[:, -1, :]
    def get_config(self):
        return super().get_config()


# L2-коэффициент для всех обучаемых ядер. На малых финансовых выборках
# регуляризация важнее ёмкости — она напрямую сдвигает val AUC вверх.
_L2 = 1e-4


def _cnn_block(inp, filters: int = 64):
    """Три параллельных свёрточных пути с разными ядрами → конкатенация."""
    branches = []
    for k in (3, 5, 7):
        x = layers.Conv1D(filters, kernel_size=k, padding="causal",
                          activation="relu", kernel_regularizer=l2(_L2))(inp)
        x = layers.BatchNormalization()(x)
        branches.append(x)
    return layers.Concatenate()(branches)          # (T, 3*filters)


def _attention_block(x, num_heads: int = 2, key_dim: int = 16):
    """Multi-Head Self-Attention + residual + layer norm."""
    attn = layers.MultiHeadAttention(num_heads=num_heads, key_dim=key_dim,
                                     dropout=0.2)(x, x)
    x = layers.Add()([x, attn])
    return layers.LayerNormalization()(x)


def build_model(lookback: int, n_features: int, cfg: Config) -> Model:
    inp = Input(shape=(lookback, n_features), name="seq")

    # --- CNN: локальные паттерны на трёх масштабах (ёмкость урезана) ---
    cnn = _cnn_block(inp, filters=16)              # (T, 48)
    cnn = layers.Dropout(0.15)(cnn)

    # --- BiLSTM: контекст по всей последовательности в обе стороны ---
    x = layers.Bidirectional(
        layers.LSTM(32, return_sequences=True,
                    kernel_regularizer=l2(_L2),
                    recurrent_regularizer=l2(_L2))
    )(cnn)                                         # (T, 64)
    x = layers.Dropout(0.3)(x)

    # --- Multi-Head Attention: акцент на ключевых барах ---
    x = _attention_block(x, num_heads=2, key_dim=16)   # (T, 64)
    x = layers.Dropout(0.2)(x)

    # --- Агрегация: последний шаг + глобальный средний пул → конкатенация ---
    last = LastStep()(x)                               # (64,)
    avg  = layers.GlobalAveragePooling1D()(x)          # (64,)
    x = layers.Concatenate()([last, avg])              # (128,)

    # --- Общий ствол перед головами (урезан + L2) ---
    x = layers.Dense(64, activation="gelu", kernel_regularizer=l2(_L2))(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(32, activation="gelu", kernel_regularizer=l2(_L2))(x)
    x = layers.BatchNormalization()(x)

    # --- Четыре выходные головы ---
    out_p = layers.Dense(1, activation="sigmoid",  name="p_up")(x)     # вероятность роста
    out_r = layers.Dense(1, activation="linear",   name="fwd_ret")(x)  # ожидаемая доходность
    out_v = layers.Dense(1, activation="softplus", name="fwd_vol")(x)  # волатильность > 0
    out_f = layers.Dense(1, activation="sigmoid",  name="p_fill")(x)   # вероятность срабатывания ордера

    model = Model(inp, [out_p, out_r, out_v, out_f])
    model.compile(
        optimizer=Adam(cfg.learning_rate),
        loss=["binary_crossentropy", "huber", "huber", "binary_crossentropy"],
        # p_up — целевая голова (по ней меряем AUC), даём ей доминирующий вес,
        # чтобы регрессионные головы (fwd_ret/fwd_vol) не перетягивали градиент.
        loss_weights=[3.0, 0.5, 0.25, 0.5],
        metrics=[["accuracy", tf.keras.metrics.AUC(name="auc")], [], [], ["accuracy"]],
    )
    return model


# =============================================================================
# 5. ОБУЧЕНИЕ / ДООБУЧЕНИЕ
# =============================================================================
def _paths(cfg: Config):
    os.makedirs(cfg.model_dir, exist_ok=True)
    base = os.path.join(cfg.model_dir, cfg.tag)
    return {
        "model": base + "_model.keras",
        "scaler": base + "_scaler.pkl",
        "config": base + "_config.json",
    }


def train(cfg: Config, warm_start: bool = False, extra_callbacks=None,
          cancel_event=None):
    df = load_ohlcv(cfg)
    index_df = _try_load_index(cfg.symbol, cfg.interval)
    htf_df   = _try_load_htf(cfg)
    data, scaler = build_dataset(df, cfg, index_df=index_df, htf_df=htf_df)

    Xtr, Xva = data["X"][data["is_train"]], data["X"][~data["is_train"]]
    tr, va = data["is_train"], ~data["is_train"]
    ytr = [data["p_up"][tr], data["fwd_ret"][tr], data["fwd_vol"][tr], data["p_fill"][tr]]
    yva = [data["p_up"][va], data["fwd_ret"][va], data["fwd_vol"][va], data["p_fill"][va]]

    fill_rate = data["p_fill"][tr].mean()
    bhr = data.get("barrier_hit_rate", 0.0)
    print(f"[train] train={len(Xtr)}  val={len(Xva)}  features={Xtr.shape[-1]}  "
          f"baseline p_up={data['p_up'][tr].mean():.3f}  fill_rate={fill_rate:.3f}  "
          f"barrier_hit_rate={bhr:.3f}")
    if bhr < 0.5:
        print(f"[train] ⚠ barrier_hit_rate={bhr:.3f} < 0.5 — большинство меток это "
              f"знак H-барной доходности (шум). Сделайте барьеры достижимее "
              f"(↓tp_atr_mult/sl_atr_mult или ↑horizon), иначе AUC застрянет у 0.5.")

    paths = _paths(cfg)
    if warm_start and os.path.exists(paths["model"]):
        print("[train] Тёплый старт: дозагружаю существующую модель")
        model = tf.keras.models.load_model(paths["model"],
                                        custom_objects={"LastStep": LastStep})
    else:
        model = build_model(cfg.lookback, Xtr.shape[-1], cfg)

    # балансировка классов p_up через sample_weight
    pos = ytr[0].mean()
    w_pos, w_neg = 0.5 / (pos + 1e-9), 0.5 / (1 - pos + 1e-9)
    sw_p = np.where(ytr[0] == 1, w_pos, w_neg).astype(np.float32)
    ones_tr = np.ones_like(sw_p)
    sample_weight = [sw_p, ones_tr, ones_tr, ones_tr]

    callbacks = [
        EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True),
        ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5),
        ModelCheckpoint(paths["model"], monitor="val_loss", save_best_only=True),
    ]
    if extra_callbacks:
        callbacks.extend(extra_callbacks)

    model.fit(
        Xtr, [ytr[0], ytr[1], ytr[2], ytr[3]],
        validation_data=(Xva, [yva[0], yva[1], yva[2], yva[3]]),
        epochs=cfg.epochs, batch_size=cfg.batch_size,
        sample_weight=sample_weight,
        callbacks=callbacks, verbose=2,
    )

    # если отменено — не тратить время на сохранение метрик
    if cancel_event and cancel_event.is_set():
        return model, scaler

    model.save(paths["model"])
    joblib.dump(scaler, paths["scaler"])
    with open(paths["config"], "w") as f:
        json.dump(asdict(cfg), f, indent=2)

    # сохраняем метрики val AUC
    val_auc = _compute_val_auc(model, Xva, yva[0])
    _save_metrics(cfg, val_auc)
    print(f"[train] Сохранено: {paths['model']}  val_auc={val_auc:.4f}")
    return model, scaler


def _save_versioned(cfg: "Config", model, val_auc: float) -> str:
    """Сохраняет копию модели с версионным индексом: TAG_interval_vN.keras.
    Возвращает путь к версионному файлу."""
    import re, shutil
    base = f"{cfg.tag}_{cfg.interval}"
    pattern = re.compile(rf"^{re.escape(base)}_v(\d+)_model\.keras$")
    existing = [
        int(m.group(1))
        for f in os.listdir(cfg.model_dir)
        if (m := pattern.match(f))
    ]
    n = max(existing, default=0) + 1
    ver_tag = f"{base}_v{n}"
    ver_model  = os.path.join(cfg.model_dir, f"{ver_tag}_model.keras")
    ver_scaler = os.path.join(cfg.model_dir, f"{ver_tag}_scaler.pkl")
    ver_config = os.path.join(cfg.model_dir, f"{ver_tag}_config.json")
    ver_metrics = os.path.join(cfg.model_dir, f"{ver_tag}_metrics.json")
    src = _paths(cfg)
    shutil.copy2(src["model"],  ver_model)
    shutil.copy2(src["scaler"], ver_scaler)
    shutil.copy2(src["config"], ver_config)
    # версионные метрики: те же данные но с тегом версии
    if os.path.exists(src["model"].replace("_model.keras", "_metrics.json")):
        shutil.copy2(src["model"].replace("_model.keras", "_metrics.json"), ver_metrics)
    return ver_model


def train_universal(symbols: list[str], interval: str = "1d",
                    epochs: int = 60, model_dir: str = "models",
                    asset_class: str = "UNIVERSAL",
                    extra_callbacks=None, log_fn=None, cancel_event=None,
                    entry_offset_mult: float | None = None,
                    period: str | None = None,
                    horizon: int | None = None,
                    lookback: int | None = None,
                    direction_filter: str = "both"):
    """
    Обучает модель класса активов на пуле инструментов.

    asset_class — тег модели: "STOCKS", "CRYPTO", "BONDS", "FOREX", "UNIVERSAL".
    Сохраняется как {asset_class}_{interval}_model.keras.

    Данные каждого инструмента нормируются своим StandardScaler,
    затем объединяются в единую выборку. Модель видит обезличенные
    относительные фичи (доходности, индикаторы) — без абсолютных цен,
    поэтому паттерны переносятся между инструментами.

    Сохраняет артефакты как 'UNIVERSAL_{interval}_model.keras' и т.д.
    На инференсе: загрузить universal-модель, передать scaler нужного
    инструмента (или fit новый на его истории).
    """
    def _log(msg):
        print(msg)
        if log_fn:
            log_fn(msg)

    # суффикс направления в имени: CRYPTO_long_1d, CRYPTO_short_1d, CRYPTO_1d
    dir_suffix = f"_{direction_filter}" if direction_filter in ("long", "short") else ""
    tag = asset_class.upper() + dir_suffix
    preset = timeframe_preset(interval)
    cfg_proto = Config(symbol=tag, interval=interval,
                       epochs=epochs, model_dir=model_dir,
                       **{k: v for k, v in preset.items()
                          if k in Config.__dataclass_fields__})
    if entry_offset_mult is not None:
        cfg_proto.entry_offset_mult = entry_offset_mult
    if period is not None:
        cfg_proto.period = period
    if horizon is not None:
        cfg_proto.horizon = horizon
    if lookback is not None:
        cfg_proto.lookback = lookback
    cfg_proto.direction_filter = direction_filter

    all_X_tr, all_X_va = [], []
    all_yp_tr, all_yr_tr, all_yv_tr, all_yf_tr = [], [], [], []
    all_yp_va, all_yr_va, all_yv_va, all_yf_va = [], [], [], []
    feature_cols = None
    scalers = {}
    bhr_list = []   # barrier_hit_rate по инструментам — для усреднённой диагностики

    for sym in symbols:
        _log(f"[universal] Загрузка {sym} {interval}…")
        cfg_i = make_config(sym, interval, epochs=epochs, model_dir=model_dir,
                            entry_offset_mult=entry_offset_mult, period=period)
        try:
            df = load_ohlcv(cfg_i)
            # В universal-режиме НЕ используем index_df (RS у каждого инструмента
            # свой и ломает согласованность фич), HTF строим из тех же данных.
            htf_df_i = _make_htf_summary(df, interval) if interval in ("1h", "4h", "1d") else None
            data, scaler_i = build_dataset(df, cfg_i, index_df=None, htf_df=htf_df_i)
        except Exception as e:
            _log(f"[universal] {sym} пропущен: {e}")
            continue

        if feature_cols is None:
            feature_cols = data["feature_cols"]
            cfg_proto.feature_cols = feature_cols
        elif data["feature_cols"] != feature_cols:
            # Диагностика: покажем какие фичи отличаются
            missing = [f for f in feature_cols if f not in data["feature_cols"]]
            extra   = [f for f in data["feature_cols"] if f not in feature_cols]
            _log(f"[universal] {sym} — несовпадение фич: "
                 f"missing={missing[:5]}, extra={extra[:5]}, пропускаем")
            continue

        scalers[sym] = scaler_i
        tr, va = data["is_train"], ~data["is_train"]
        all_X_tr.append(data["X"][tr]);  all_X_va.append(data["X"][va])
        all_yp_tr.append(data["p_up"][tr]); all_yr_tr.append(data["fwd_ret"][tr])
        all_yv_tr.append(data["fwd_vol"][tr]); all_yf_tr.append(data["p_fill"][tr])
        all_yp_va.append(data["p_up"][va]); all_yr_va.append(data["fwd_ret"][va])
        all_yv_va.append(data["fwd_vol"][va]); all_yf_va.append(data["p_fill"][va])
        bhr_list.append(data.get("barrier_hit_rate", 0.0))
        _log(f"[universal] {sym}: train={tr.sum()} val={va.sum()} "
             f"barrier_hit_rate={data.get('barrier_hit_rate', 0.0):.3f}")

    if not all_X_tr:
        raise RuntimeError("Не удалось загрузить ни одного инструмента.")

    Xtr = np.concatenate(all_X_tr)
    Xva = np.concatenate(all_X_va)
    ytr = [np.concatenate(all_yp_tr), np.concatenate(all_yr_tr),
           np.concatenate(all_yv_tr), np.concatenate(all_yf_tr)]
    yva = [np.concatenate(all_yp_va), np.concatenate(all_yr_va),
           np.concatenate(all_yv_va), np.concatenate(all_yf_va)]

    # перемешиваем train (val оставляем упорядоченным — не критично для оценки)
    idx = np.random.permutation(len(Xtr))
    Xtr, ytr = Xtr[idx], [y[idx] for y in ytr]

    fill_rate = ytr[3].mean()
    mean_bhr = float(np.mean(bhr_list)) if bhr_list else 0.0
    _log(f"[universal] Итого: train={len(Xtr)} val={len(Xva)} features={Xtr.shape[-1]}  "
         f"fill_rate={fill_rate:.3f}  barrier_hit_rate≈{mean_bhr:.3f}")
    if mean_bhr < 0.5:
        _log(f"[universal] ⚠ barrier_hit_rate≈{mean_bhr:.3f} < 0.5 — метки в основном "
             f"знак H-барной доходности (шум). Сделайте барьеры достижимее.")

    pos = ytr[0].mean()
    w_pos, w_neg = 0.5 / (pos + 1e-9), 0.5 / (1 - pos + 1e-9)
    sw_p = np.where(ytr[0] == 1, w_pos, w_neg).astype(np.float32)
    ones_tr = np.ones_like(sw_p)

    paths = _paths(cfg_proto)
    model = build_model(cfg_proto.lookback, Xtr.shape[-1], cfg_proto)

    callbacks = [
        EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True),
        ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5),
        ModelCheckpoint(paths["model"], monitor="val_loss", save_best_only=True),
    ]
    if extra_callbacks:
        callbacks.extend(extra_callbacks)

    model.fit(
        Xtr, ytr,
        validation_data=(Xva, yva),
        epochs=cfg_proto.epochs, batch_size=cfg_proto.batch_size,
        sample_weight=[sw_p, ones_tr, ones_tr, ones_tr],
        callbacks=callbacks, verbose=2,
    )

    if cancel_event and cancel_event.is_set():
        return model, scalers

    model.save(paths["model"])
    # сохраняем scaler первого инструмента как «эталонный»
    joblib.dump(next(iter(scalers.values())), paths["scaler"])
    with open(paths["config"], "w") as f:
        json.dump(asdict(cfg_proto), f, indent=2)

    val_auc = _compute_val_auc(model, Xva, yva[0])
    _save_metrics(cfg_proto, val_auc)

    # версионирование: сохраняем копию с индексом TAG_interval_vN.keras
    _save_versioned(cfg_proto, model, val_auc)

    _log(f"[universal] Модель сохранена: {paths['model']}  val_auc={val_auc:.4f}")
    _log(f"[universal] Обучена на: {', '.join(scalers.keys())}")
    return model, scalers


def retrain(cfg: Config):
    """Периодическое дообучение: свежие данные + тёплый старт от текущих весов."""
    print(f"[retrain] {datetime.now():%Y-%m-%d %H:%M} — дообучение {cfg.tag}")
    model, scaler = train(cfg, warm_start=True)
    # версионируем снимок
    paths = _paths(cfg)
    snap = os.path.join(cfg.model_dir, f"{cfg.tag}_{datetime.now():%Y%m%d_%H%M}.keras")
    model.save(snap)
    print(f"[retrain] Снимок версии: {snap}")
    return model, scaler


# =============================================================================
# 6. ИНФЕРЕНС: генерация торгового сигнала (entry / SL / TP)
# =============================================================================
def load_artifacts(cfg: Config, active_tags: list[str] | None = None):
    tag = resolve_model_tag(cfg.symbol, cfg.interval, cfg.model_dir,
                            active_tags=active_tags or None)
    # если выбрана не индивидуальная модель — логируем
    own_tag = cfg.tag
    if tag != own_tag:
        print(f"[infer] Индивидуальной модели для '{cfg.symbol}' нет. "
              f"Используется: {tag}")

    load_cfg = cfg if tag == own_tag else Config(
        symbol=tag.rsplit("_", 1)[0], interval=cfg.interval, model_dir=cfg.model_dir
    )
    paths = _paths(load_cfg)

    model = tf.keras.models.load_model(paths["model"],
                                       custom_objects={"LastStep": LastStep})
    scaler = joblib.load(paths["scaler"])
    with open(paths["config"]) as f:
        saved = json.load(f)
    cfg.feature_cols = saved["feature_cols"]
    for k in ("lookback", "horizon", "tp_atr_mult", "sl_atr_mult",
              "prob_threshold", "min_rr", "direction_filter"):
        if k in saved:
            setattr(cfg, k, saved[k])
    return model, scaler


def _infer_features(cfg: Config, df: pd.DataFrame, scaler) -> tuple:
    """
    Строит матрицу признаков для инференса (те же фичи, что при обучении).
    Возвращает (X_scaled, feats).
    """
    index_df = _try_load_index(cfg.symbol, cfg.interval)
    htf_df   = _make_htf_summary(df, cfg.interval) if cfg.interval in ("1h", "4h", "1d") else None

    feats = add_features(df, interval=cfg.interval,
                         index_df=index_df,
                         htf_df=htf_df).replace([np.inf, -np.inf], np.nan)

    # используем только те колонки, на которых обучали
    available_cols = [c for c in cfg.feature_cols if c in feats.columns]
    missing_cols   = [c for c in cfg.feature_cols if c not in feats.columns]
    if missing_cols:
        print(f"[infer] Отсутствующие фичи (заполняем 0): {missing_cols}")

    X_raw = np.zeros((len(feats), len(cfg.feature_cols)), dtype=np.float32)
    for i, col in enumerate(cfg.feature_cols):
        if col in feats.columns:
            X_raw[:, i] = feats[col].to_numpy(dtype=np.float32)

    X_clean = np.nan_to_num(X_raw)

    from sklearn.preprocessing import StandardScaler as _SS
    if not hasattr(scaler, "mean_") or scaler.mean_ is None or np.all(scaler.mean_ == 0):
        split = int(len(X_clean) * (1 - cfg.val_fraction))
        train_part = X_clean[:split]
        finite_rows = np.isfinite(X_clean).all(axis=1)[:split]
        scaler = _SS().fit(train_part[finite_rows] if finite_rows.any() else train_part)

    return scaler.transform(X_clean), feats


def predict_signal(cfg: Config, df: pd.DataFrame | None = None) -> dict:
    """Берёт последнее окно данных и выдаёт сигнал входа/стопа/тейка."""
    model, scaler = load_artifacts(cfg)
    if df is None:
        df = load_ohlcv(cfg)

    X_scaled, feats = _infer_features(cfg, df, scaler)

    L = cfg.lookback
    window = X_scaled[-L:][None, ...]
    outputs = model.predict(window, verbose=0)

    # Поддерживаем старые модели с 3 выходами и новые с 4
    if len(outputs) >= 4:
        p_up, fwd_ret, fwd_vol, p_fill = [float(o[0, 0]) for o in outputs[:4]]
    else:
        p_up, fwd_ret, fwd_vol = [float(o[0, 0]) for o in outputs[:3]]
        p_fill = 1.0  # старая модель — всегда маркет-вход

    price = float(df["close"].iloc[-1])
    atr = float(feats["atr"].iloc[-1])

    # Клэмпим ATR: не менее 0.1% и не более 5% от цены
    atr_clamped = float(np.clip(atr, 0.001 * price, 0.05 * price))
    offset = cfg.entry_offset_mult  # смещение ордера

    # SL/TP: берём максимум из ATR и прогнозируемой волатильности (fwd_vol в ед. цены)
    vol_abs = max(fwd_vol * price, 0.2 * atr_clamped)
    sl_dist = cfg.sl_atr_mult * vol_abs
    tp_dist = cfg.tp_atr_mult * vol_abs

    # выбор направления (с учётом p_fill — комбинированная вероятность)
    direction = "FLAT"
    order_type = "MARKET"

    if offset > 0:
        # Отложенный ордер: фильтруем по p_fill * p_direction >= threshold
        if p_up * p_fill >= cfg.prob_threshold * cfg.fill_prob_threshold and fwd_ret > 0:
            direction = "LONG"
            order_type = "BUYSTOP"
        elif (1 - p_up) * p_fill >= cfg.prob_threshold * cfg.fill_prob_threshold and fwd_ret < 0:
            direction = "SHORT"
            order_type = "SELLSTOP"
    else:
        # Маркет-вход (оригинальная логика)
        if p_up >= cfg.prob_threshold and fwd_ret > 0:
            direction = "LONG"
        elif (1 - p_up) >= cfg.prob_threshold and fwd_ret < 0:
            direction = "SHORT"

    # фильтр направления модели
    df_flt = getattr(cfg, "direction_filter", "both")
    if df_flt == "long" and direction == "SHORT":
        direction = "FLAT"; order_type = "MARKET"
    elif df_flt == "short" and direction == "LONG":
        direction = "FLAT"; order_type = "MARKET"

    raw_rr = tp_dist / (sl_dist + 1e-9)

    if direction != "FLAT" and raw_rr < cfg.min_rr:
        direction = "FLAT"
        order_type = "MARKET"

    if direction == "LONG":
        entry = price + offset * atr_clamped if offset > 0 else price
        sl = entry - sl_dist
        tp = entry + tp_dist
    elif direction == "SHORT":
        entry = price - offset * atr_clamped if offset > 0 else price
        sl = entry + sl_dist
        tp = entry - tp_dist
    else:
        entry = price + offset * atr_clamped if offset > 0 else price
        sl = tp = price

    # Прибыль/Риск = |TP - entry| / |entry - SL|
    if direction in ("LONG", "SHORT"):
        exp_rr = round(abs(tp - entry) / (abs(entry - sl) + 1e-9), 2)
    else:
        exp_rr = 0.0

    # дедлайн исполнения ордера (горизонт в барах от текущего момента)
    bar_index = df.index[-1]
    fill_deadline = None
    if offset > 0 and direction != "FLAT":
        try:
            freq_map = {"1d": "B", "4h": "4h", "1h": "1h"}
            freq = freq_map.get(cfg.interval, cfg.interval)
            fill_deadline = str(
                pd.bdate_range(start=bar_index, periods=cfg.horizon + 1, freq=freq)[-1]
            )
        except Exception:
            fill_deadline = None

    signal = {
        "time": str(bar_index),
        "symbol": cfg.symbol,
        "direction": direction,
        "order_type": order_type,
        "entry": round(entry, 2),
        "stop_loss": round(sl, 2),
        "take_profit": round(tp, 2),
        "prob_up": round(p_up, 3),
        "p_fill": round(p_fill, 3),
        "exp_return": round(fwd_ret, 4),
        "exp_vol": round(fwd_vol, 4),
        "risk_reward": exp_rr,
        "confidence": round(max(p_up, 1 - p_up), 3),
        "fill_deadline": fill_deadline,
        "entry_offset_atr": round(offset * atr_clamped, 4) if offset > 0 else 0,
    }
    return signal


def forecast(cfg: Config, steps: int = 10, history: int = 50,
             band_k: float = 1.0, df: pd.DataFrame | None = None,
             active_tags: list[str] | None = None) -> dict:
    """
    Возвращает данные для графика прогноза:
        history  — последние `history` баров (time, close)
        forecast — прогнозный «отросток» на `steps` баров вперёд:
                   mid (ожидаемая траектория) + конус неопределённости
                   (upper/lower) расширяющийся как vol*sqrt(t)
        signal/levels — вход, стоп-лосс, тейк-профит и направление

    Прогноз честно отражает ограничения модели: mid — это интерполяция
    ожидаемой доходности к горизонту, а конус — оценка волатильности.
    Это ориентир, а не предсказание точной цены каждого бара.
    """
    model, scaler = load_artifacts(cfg, active_tags=active_tags)
    if df is None:
        df = load_ohlcv(cfg)

    X_scaled, feats = _infer_features(cfg, df, scaler)
    window = X_scaled[-cfg.lookback:][None, ...]
    _outs = model.predict(window, verbose=0)
    p_up, fwd_ret, fwd_vol = [float(o[0, 0]) for o in _outs[:3]]

    price0 = float(df["close"].iloc[-1])
    per_bar_vol = max(fwd_vol, 1e-4)
    H = max(cfg.horizon, 1)

    # сигнал (та же логика, что в predict_signal) — через общий вызов
    sig = predict_signal(cfg, df)

    # ── Pivot Points — период агрегации зависит от таймфрейма ─────────────────
    # D1  → High/Low/Close за последний месяц  (~22 торговых дня)
    # H4  → за последнюю неделю               (~5 дней × 6 баров = 30 баров)
    # H1  → за последний день                 (~24 бара)
    # иное → последняя свеча (fallback)
    _pivot_bars = {"1d": 22, "4h": 30, "1h": 24}.get(cfg.interval, 1)
    _pivot_slice = df.iloc[-_pivot_bars:]
    _ph = float(_pivot_slice["high"].max())
    _pl = float(_pivot_slice["low"].min())
    _pc = float(_pivot_slice["close"].iloc[-1])
    _pp  = (_ph + _pl + _pc) / 3
    _r1  = 2 * _pp - _pl
    _r2  = _pp + (_ph - _pl)
    _r3  = _ph + 2 * (_pp - _pl)
    _s1  = 2 * _pp - _ph
    _s2  = _pp - (_ph - _pl)
    _s3  = _pl - 2 * (_ph - _pp)
    pivot_levels = {
        "pp": round(_pp, 2),
        "r1": round(_r1, 2), "r2": round(_r2, 2), "r3": round(_r3, 2),
        "s1": round(_s1, 2), "s2": round(_s2, 2), "s3": round(_s3, 2),
        "period_bars": _pivot_bars,
    }

    # ── Прогнозные свечи ──────────────────────────────────────────────────────
    # Паттерн направлений: по тренду с периодическими коррекциями.
    # Свечи «притягиваются» к ближайшему уровню пивота (PP/R1..R3/S1..S3),
    # имитируя реальное поведение цены у значимых уровней.
    _bull_trend = fwd_ret >= 0
    _pattern = [True, True, False, True, True, True, False, True,
                False, True, True, False, True, True, False]
    # все уровни пивота в виде sorted-списка для поиска ближайшего
    _pivot_vals = sorted([_s3, _s2, _s1, _pp, _r1, _r2, _r3])

    prev_h = _ph
    prev_l = _pl
    prev_c = price0
    path = []
    for t in range(1, steps + 1):
        frac = min(t / H, 1.0)
        mid  = price0 * (1 + fwd_ret * frac)
        band = band_k * per_bar_vol * (t ** 0.5)

        # пивот от текущего prev_h/prev_l/prev_c
        pp  = (prev_h + prev_l + prev_c) / 3
        r1  = 2 * pp - prev_l
        s1  = 2 * pp - prev_h
        rng = max(r1 - s1, prev_c * 0.001)

        with_trend = _pattern[(t - 1) % len(_pattern)]
        is_bull    = with_trend == _bull_trend

        # ближайший уровень глобального пивота к mid — свеча «магнетится» к нему
        nearest_pivot = min(_pivot_vals, key=lambda v: abs(v - mid))

        if is_bull:
            bar_open  = pp - rng * 0.15
            bar_close = pp + rng * 0.35
        else:
            bar_open  = pp + rng * 0.15
            bar_close = pp - rng * 0.35

        # pull к mid, с лёгким притяжением к ближайшему уровню пивота
        pull = 0.6 if with_trend else 0.25
        target = mid * 0.75 + nearest_pivot * 0.25   # mid доминирует, пивот корректирует
        bar_close = bar_close * (1 - pull) + target * pull
        bar_open  = prev_c * 0.5 + pp * 0.5

        bar_high = max(bar_open, bar_close) + rng * 0.20
        bar_low  = min(bar_open, bar_close) - rng * 0.20
        bar_high = max(bar_high, bar_open, bar_close)
        bar_low  = min(bar_low,  bar_open, bar_close)

        path.append({
            "step":  t,
            "mid":   round(mid, 2),
            "upper": round(mid * (1 + band), 2),
            "lower": round(max(mid * (1 - band), 0.0), 2),
            "open":  round(bar_open,  2),
            "high":  round(bar_high,  2),
            "low":   round(bar_low,   2),
            "close": round(bar_close, 2),
        })
        prev_h, prev_l, prev_c = bar_high, bar_low, bar_close

    hist = df.iloc[-history:]
    history_pts = [
        {
            "time":  str(ts),
            "open":  round(float(row.open),  2),
            "high":  round(float(row.high),  2),
            "low":   round(float(row.low),   2),
            "close": round(float(row.close), 2),
        }
        for ts, row in hist.iterrows()
    ]

    return {
        "symbol": cfg.symbol,
        "interval": cfg.interval,
        "last_time": str(df.index[-1]),
        "last_price": round(price0, 2),
        "history": history_pts,
        "forecast": path,
        "pivot_levels": pivot_levels,
        "signal": sig,
        "levels": {
            "direction": sig["direction"],
            "entry": sig["entry"],
            "stop_loss": sig["stop_loss"],
            "take_profit": sig["take_profit"],
        },
    }


# =============================================================================
# 7. МЕТРИКИ КАЧЕСТВА МОДЕЛЕЙ (val AUC, мониторинг деградации)
# =============================================================================

# Пороги AUC: критично < 0.54, предупреждение < 0.56, норма >= 0.56
AUC_THRESHOLD_WARN     = 0.54   # ниже → warn
AUC_THRESHOLD_RETRAIN  = 0.52   # ниже → автоматически запустить retrain
AUC_THRESHOLD_OK       = 0.56   # выше → всё хорошо


def _compute_val_auc(model, Xva: np.ndarray, yva: np.ndarray) -> float:
    """Быстрый расчёт val AUC по уже подготовленным выборкам."""
    from sklearn.metrics import roc_auc_score
    try:
        preds = model.predict(Xva, verbose=0)[0].ravel()
        return float(roc_auc_score(yva, preds))
    except Exception:
        return 0.5


def _save_metrics(cfg: Config, val_auc: float):
    """Сохраняет метрики в {tag}_metrics.json рядом с моделью."""
    paths = _paths(cfg)
    metrics_path = paths["model"].replace("_model.keras", "_metrics.json")
    existing: dict = {}
    if os.path.exists(metrics_path):
        try:
            with open(metrics_path, encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            pass

    history = existing.get("history", [])
    history.append({
        "ts": datetime.now().isoformat(timespec="seconds"),
        "val_auc": round(val_auc, 5),
    })
    history = history[-30:]  # храним последние 30 точек

    status = (
        "ok"       if val_auc >= AUC_THRESHOLD_OK
        else "warn"     if val_auc >= AUC_THRESHOLD_WARN
        else "critical"
    )
    data = {
        "tag":      cfg.tag,
        "symbol":   cfg.symbol,
        "interval": cfg.interval,
        "val_auc":  round(val_auc, 5),
        "status":   status,
        "updated":  datetime.now().isoformat(timespec="seconds"),
        "history":  history,
    }
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_model_metrics(tag: str, model_dir: str = "models") -> dict | None:
    """Загружает метрики конкретной модели по тегу."""
    path = os.path.join(model_dir, f"{tag}_metrics.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def get_all_metrics(model_dir: str = "models") -> list[dict]:
    """
    Возвращает метрики всех обученных моделей.
    Для моделей без _metrics.json делает быстрый расчёт AUC на лету
    и сохраняет результат.
    """
    if not os.path.isdir(model_dir):
        return []

    import re as _re
    _ver_pat = _re.compile(r"_v\d+_model\.keras$")
    results = []
    for fname in sorted(os.listdir(model_dir)):
        if not fname.endswith("_model.keras"):
            continue
        if _ver_pat.search(fname):
            continue  # пропускаем версионные копии (CRYPTO_1d_v1_model.keras)
        tag = fname[:-len("_model.keras")]
        metrics = get_model_metrics(tag, model_dir)
        if metrics:
            results.append(metrics)
        else:
            # метрик нет — добавляем запись-заглушку без пересчёта
            # (пересчёт дорогой, делается по запросу или после retrain)
            parts = tag.rsplit("_", 1)
            results.append({
                "tag":      tag,
                "symbol":   parts[0] if len(parts) == 2 else tag,
                "interval": parts[1] if len(parts) == 2 else "",
                "val_auc":  None,
                "status":   "unknown",
                "updated":  None,
                "history":  [],
            })
    return results


def refresh_model_metrics(tag: str, model_dir: str = "models") -> dict:
    """
    Загружает модель и данные, пересчитывает val AUC, сохраняет метрики.
    Для классовых моделей (STOCKS, CRYPTO…) берём первый символ из класса.
    """
    parts = tag.rsplit("_", 1)
    if len(parts) != 2:
        raise ValueError(f"Не удалось разобрать тег: {tag}")
    symbol_or_class, interval = parts

    # классовая модель: symbol_or_class ∈ ASSET_CLASS_META (в верхнем регистре)
    cls_key = symbol_or_class.lower()
    if cls_key in ASSET_CLASS_META:
        symbols = ASSET_CLASS_META[cls_key].get("default_symbols", [])
        if not symbols:
            raise ValueError(f"Нет символов для класса {symbol_or_class}")
        # берём первый доступный символ
        symbol = symbols[0]
    else:
        symbol = symbol_or_class

    cfg = make_config(symbol, interval, model_dir=model_dir)
    model, scaler = load_artifacts(cfg)

    df = load_ohlcv(cfg)
    index_df = _try_load_index(cfg.symbol, cfg.interval)
    htf_df   = _make_htf_summary(df, cfg.interval) if cfg.interval in ("1h", "4h", "1d") else None
    data, _  = build_dataset(df, cfg, scaler=scaler, fit_scaler=False,
                              index_df=index_df, htf_df=htf_df)

    Xva = data["X"][~data["is_train"]]
    yva = data["p_up"][~data["is_train"]]
    val_auc = _compute_val_auc(model, Xva, yva)

    # сохраняем под тегом классовой модели, а не первого символа
    cfg_save = make_config(symbol_or_class, interval, model_dir=model_dir)
    _save_metrics(cfg_save, val_auc)
    return get_model_metrics(tag, model_dir)


# =============================================================================
# 8. FEATURE IMPORTANCE (permutation importance на валидационной выборке)
# =============================================================================

def compute_feature_importance(cfg: Config, n_repeats: int = 3) -> list[dict]:
    """
    Permutation importance: для каждого признака перемешиваем его значения
    в валидационной выборке и смотрим, насколько ухудшается бинарный AUC
    на голове p_up. Метрика — drop_auc (чем больше, тем важнее признак).

    Возвращает список словарей, отсортированный по убыванию важности:
        [{"feature": str, "importance": float, "rank": int}, ...]
    """
    from sklearn.metrics import roc_auc_score

    model, scaler = load_artifacts(cfg)
    df = load_ohlcv(cfg)
    index_df = _try_load_index(cfg.symbol, cfg.interval)
    htf_df   = _make_htf_summary(df, cfg.interval) if cfg.interval in ("1h", "4h", "1d") else None
    data, _  = build_dataset(df, cfg, scaler=scaler, fit_scaler=False,
                              index_df=index_df, htf_df=htf_df)

    Xva = data["X"][~data["is_train"]]
    yva = data["p_up"][~data["is_train"]]

    if len(Xva) < 20:
        raise RuntimeError("Слишком мало данных в валидации для расчёта feature importance")

    # базовый AUC
    def _auc(X):
        preds = model.predict(X, verbose=0)[0].ravel()
        try:
            return roc_auc_score(yva, preds)
        except Exception:
            return 0.5

    base_auc = _auc(Xva)
    rng = np.random.default_rng(42)
    n_feat = Xva.shape[2]  # (samples, lookback, features)

    importances = []
    for fi in range(n_feat):
        drops = []
        for _ in range(n_repeats):
            X_perm = Xva.copy()
            perm_idx = rng.permutation(len(X_perm))
            X_perm[:, :, fi] = X_perm[perm_idx, :, fi]
            drops.append(base_auc - _auc(X_perm))
        importances.append(float(np.mean(drops)))

    feature_names = cfg.feature_cols
    results = sorted(
        [{"feature": feature_names[i], "importance": round(importances[i], 5), "rank": 0}
         for i in range(min(n_feat, len(feature_names)))],
        key=lambda x: x["importance"], reverse=True,
    )
    for rank, item in enumerate(results, 1):
        item["rank"] = rank

    # сохраняем рядом с моделью
    paths = _paths(cfg)
    fi_path = paths["model"].replace("_model.keras", "_feature_importance.json")
    with open(fi_path, "w", encoding="utf-8") as f:
        json.dump({"base_auc": round(base_auc, 5), "features": results}, f,
                  ensure_ascii=False, indent=2)
    print(f"[importance] Сохранено: {fi_path}  base_auc={base_auc:.4f}")
    return results


def load_feature_importance(cfg: Config) -> dict | None:
    """Загружает ранее сохранённый результат feature importance (если есть)."""
    tag = resolve_model_tag(cfg.symbol, cfg.interval, cfg.model_dir)
    load_cfg = cfg if tag == cfg.tag else Config(
        symbol=tag.rsplit("_", 1)[0], interval=cfg.interval, model_dir=cfg.model_dir
    )
    fi_path = os.path.join(load_cfg.model_dir,
                           f"{load_cfg.tag}_feature_importance.json")
    if not os.path.exists(fi_path):
        return None
    with open(fi_path, encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# 8. CLI
# =============================================================================
def parse_args():
    p = argparse.ArgumentParser(description="Trading NN: entry / SL / TP")
    p.add_argument("mode", choices=["train", "predict", "retrain"])
    p.add_argument("--symbol", default="IMOEX")
    p.add_argument("--interval", default="1d", help="1d / 4h / 1h")
    # None -> взять из пресета таймфрейма
    p.add_argument("--period", default=None)
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--horizon", type=int, default=None)
    p.add_argument("--lookback", type=int, default=None)
    return p.parse_args()


def main():
    args = parse_args()
    # пресет под таймфрейм + явные переопределения сверху
    cfg = make_config(args.symbol, args.interval, period=args.period,
                      epochs=args.epochs, horizon=args.horizon, lookback=args.lookback)
    print(f"[cfg] {cfg.symbol} {cfg.interval}: horizon={cfg.horizon} "
          f"lookback={cfg.lookback} period={cfg.period}")

    if args.mode == "train":
        train(cfg)
    elif args.mode == "retrain":
        retrain(cfg)
    elif args.mode == "predict":
        sig = predict_signal(cfg)
        print("\n=== ТОРГОВЫЙ СИГНАЛ ===")
        print(json.dumps(sig, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
