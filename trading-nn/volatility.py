"""
volatility.py
=============
Статистические модели оценки и прогноза волатильности.

Две модели, дополняющие друг друга:

  GARCH(1,1) — захватывает кластеризацию волатильности (большие движения следуют
               за большими). Хорош для краткосрочного прогноза (1–5 баров).
               Оценивается максимальным правдоподобием (MLE).

  HAR-RV     — Heterogeneous AutoRegressive model of Realized Volatility
               (Corsi, 2009). Аддитивная регрессия трёх компонент:
               дневная (RV_d), недельная (RV_w=среднее за 5), месячная (RV_m=среднее за 22).
               Хорошо захватывает долгосрочную память волатильности.

Оба выдают:
  - current_vol  : оценка текущей волатильности (annualized %)
  - forecast[]   : список {step, vol, annualized} на горизонт 1..max_horizon баров
  - half_life    : (GARCH) число баров до возврата к среднему
  - persistence  : (GARCH) alpha+beta, мера «памяти» шоков

Аннуализация: vol_annual = vol_per_bar * sqrt(bars_per_year).
bars_per_year подбирается по таймфрейму из BARS_PER_YEAR.
"""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np
import pandas as pd
from scipy.optimize import minimize

# Примерное число торговых баров в году по таймфреймам Мосбиржи
BARS_PER_YEAR = {
    "1d":  250,
    "4h":  750,    # ~3 бара/день × 250
    "1h":  3250,   # ~13 баров/день (с вечерней сессией) × 250
    "30m": 6500,
    "15m": 13000,
}
_DEFAULT_BPY = 252


# =============================================================================
# Вспомогательные типы
# =============================================================================
class GARCHResult(NamedTuple):
    omega: float
    alpha: float
    beta: float
    current_var: float       # условная дисперсия на последнем баре
    long_run_var: float      # безусловная (долгосрочная) дисперсия
    persistence: float       # alpha + beta
    half_life: float         # баров до возврата к long_run_var
    log_likelihood: float


class HARResult(NamedTuple):
    c: float                 # константа
    beta_d: float            # коэф. при дневной RV
    beta_w: float            # коэф. при недельной RV
    beta_m: float            # коэф. при месячной RV
    current_rv: float        # последнее значение RV (дневная)
    rv_w: float              # последнее значение RV_w
    rv_m: float              # последнее значение RV_m
    r_squared: float


# =============================================================================
# GARCH(1,1)
# =============================================================================
def fit_garch(returns: np.ndarray) -> GARCHResult:
    """
    Оценка GARCH(1,1): h_t = omega + alpha*eps_{t-1}^2 + beta*h_{t-1}
    через минимизацию отрицательного логарифмического правдоподобия.

    returns — массив лог-доходностей (нулевое среднее не обязательно, модель
              использует mean-centered ряд внутри).
    """
    r = np.asarray(returns, dtype=np.float64)
    r = r[np.isfinite(r)]
    r = r - r.mean()

    n = len(r)
    if n < 50:
        raise ValueError(f"GARCH требует минимум 50 наблюдений, получено {n}")

    var_unconditional = float(np.var(r))

    def neg_log_likelihood(params):
        omega, alpha, beta = params
        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 1:
            return 1e10
        h = np.empty(n)
        h[0] = var_unconditional
        for t in range(1, n):
            h[t] = omega + alpha * r[t - 1] ** 2 + beta * h[t - 1]
            if h[t] <= 0:
                return 1e10
        ll = -0.5 * np.sum(np.log(h) + r ** 2 / h)
        return -ll

    # стартовая точка: omega из безусловной дисперсии, alpha=0.1, beta=0.85
    omega0 = var_unconditional * (1 - 0.1 - 0.85)
    x0 = [max(omega0, 1e-8), 0.1, 0.85]
    bounds = [(1e-9, None), (1e-6, 0.999), (1e-6, 0.999)]

    res = minimize(neg_log_likelihood, x0, method="L-BFGS-B", bounds=bounds,
                   options={"maxiter": 500, "ftol": 1e-12})

    omega, alpha, beta = res.x
    persistence = alpha + beta
    long_run_var = omega / (1 - persistence) if persistence < 1 else var_unconditional

    # фильтр Калмана для получения текущей h_T
    h = var_unconditional
    for t in range(n):
        if t > 0:
            h = omega + alpha * r[t - 1] ** 2 + beta * h
    current_var = h

    # время полужизни шока: h_t - h_inf ~ persistence^t * (h_0 - h_inf)
    if persistence < 1 and persistence > 0:
        half_life = math.log(0.5) / math.log(persistence)
    else:
        half_life = float("inf")

    return GARCHResult(
        omega=omega, alpha=alpha, beta=beta,
        current_var=current_var, long_run_var=long_run_var,
        persistence=persistence, half_life=half_life,
        log_likelihood=-res.fun,
    )


def garch_forecast(garch: GARCHResult, last_return: float,
                   horizon: int = 30) -> np.ndarray:
    """
    Прогноз условной дисперсии GARCH на h шагов вперёд.
    Для h>1 используется аналитическая формула:
        E[h_{T+k}] = long_run_var + persistence^k * (h_T - long_run_var)
    """
    forecasts = np.empty(horizon)
    spread = garch.current_var - garch.long_run_var
    for k in range(1, horizon + 1):
        forecasts[k - 1] = garch.long_run_var + garch.persistence ** k * spread
    return np.maximum(forecasts, 1e-12)


# =============================================================================
# HAR-RV (Corsi 2009)
# =============================================================================
def _realized_variance(returns: np.ndarray) -> np.ndarray:
    """RV_t = sum(r_tau^2) за бар t. Здесь один бар = один return^2."""
    return returns ** 2


def fit_har(returns: np.ndarray, d: int = 1, w: int = 5, m: int = 22) -> HARResult:
    """
    HAR-RV: RV_{t+1} = c + b_d*RV_d_t + b_w*RV_w_t + b_m*RV_m_t + eps

    Компоненты:
      RV_d_t  = RV_t                        (дневная — последний бар)
      RV_w_t  = mean(RV_{t-w+1}..RV_t)      (недельная)
      RV_m_t  = mean(RV_{t-m+1}..RV_t)      (месячная)

    Оценка через OLS (обычный МНК), что даёт несмещённые коэффициенты
    при нормальных остатках. Для финансов это хорошее приближение.
    """
    r = np.asarray(returns, dtype=np.float64)
    r = r[np.isfinite(r)]

    if len(r) < m + 10:
        raise ValueError(f"HAR требует минимум {m + 10} наблюдений, получено {len(r)}")

    rv = _realized_variance(r)
    n = len(rv)

    # строим матрицу регрессоров
    rows = []
    targets = []
    for t in range(m, n - 1):
        rv_d = rv[t]
        rv_w = rv[max(0, t - w + 1):t + 1].mean()
        rv_m = rv[max(0, t - m + 1):t + 1].mean()
        rows.append([1.0, rv_d, rv_w, rv_m])
        targets.append(rv[t + 1])  # прогноз на следующий бар

    X = np.array(rows)
    y = np.array(targets)

    # OLS: beta = (X'X)^{-1} X'y
    XtX = X.T @ X
    Xty = X.T @ y
    try:
        coef = np.linalg.solve(XtX, Xty)
    except np.linalg.LinAlgError:
        coef = np.linalg.lstsq(X, y, rcond=None)[0]

    c, b_d, b_w, b_m = coef

    y_hat = X @ coef
    ss_res = np.sum((y - y_hat) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = 1 - ss_res / (ss_tot + 1e-12)

    # текущие значения компонент
    rv_d_now = rv[-1]
    rv_w_now = rv[max(0, n - w):].mean()
    rv_m_now = rv[max(0, n - m):].mean()

    return HARResult(
        c=c, beta_d=b_d, beta_w=b_w, beta_m=b_m,
        current_rv=rv_d_now, rv_w=rv_w_now, rv_m=rv_m_now,
        r_squared=float(r2),
    )


def har_forecast(har: HARResult, horizon: int = 30) -> np.ndarray:
    """
    Итеративный прогноз HAR на horizon шагов.
    На каждом шаге новое RV подставляется обратно как компонента дневная/недельная/месячная
    (приближение — скользящие средние обновляются рекурсивно).

    Это стандартный подход для multi-step HAR: прогноз устойчив, но сглаживается.
    """
    # буферы последних m значений RV (инициализируем из текущих компонент)
    buf = np.full(max(22, horizon + 1), har.current_rv)  # заполняем текущим RV

    forecasts = np.empty(horizon)
    for k in range(horizon):
        rv_d = buf[-1]
        rv_w = buf[-5:].mean()
        rv_m = buf[-22:].mean()
        rv_next = har.c + har.beta_d * rv_d + har.beta_w * rv_w + har.beta_m * rv_m
        rv_next = max(rv_next, 1e-12)  # дисперсия не бывает < 0
        forecasts[k] = rv_next
        buf = np.append(buf, rv_next)

    return forecasts


# =============================================================================
# Публичный API: единая точка входа
# =============================================================================
def volatility_forecast(
    df: pd.DataFrame,
    interval: str = "1d",
    horizon: int = 30,
) -> dict:
    """
    Принимает OHLCV DataFrame, возвращает словарь с прогнозами GARCH и HAR-RV.

    Аргументы:
        df       — DataFrame с колонками [open, high, low, close, volume]
        interval — таймфрейм строкой ('1d', '4h', '1h', ...) — нужен для аннуализации
        horizon  — горизонт прогноза в барах (1..30)

    Возвращает:
        {
          "garch": {
              "current_vol": float,        # текущая vol (аннуализированная, %)
              "persistence": float,
              "half_life": float,
              "params": {omega, alpha, beta},
              "forecast": [{step, var, vol, annualized}, ...],
          },
          "har": {
              "current_vol": float,
              "r_squared": float,
              "params": {c, beta_d, beta_w, beta_m},
              "forecast": [{step, rv, vol, annualized}, ...],
          },
          "ensemble": {
              "forecast": [{step, vol, annualized}, ...],  # среднее GARCH и HAR
          },
          "meta": {
              "n_bars": int,
              "interval": str,
              "bars_per_year": int,
              "horizon": int,
          }
        }
    """
    horizon = max(1, min(horizon, 30))
    bpy = BARS_PER_YEAR.get(interval, _DEFAULT_BPY)
    ann_factor = math.sqrt(bpy)

    # лог-доходности
    log_ret = np.log(df["close"] / df["close"].shift(1)).dropna().to_numpy()

    # --- GARCH ---
    garch = fit_garch(log_ret)
    last_ret = float(log_ret[-1])
    garch_var_fcast = garch_forecast(garch, last_ret, horizon)
    garch_current_vol = math.sqrt(garch.current_var) * ann_factor * 100

    garch_fcast_list = [
        {
            "step": k + 1,
            "var": round(float(v), 8),
            "vol": round(math.sqrt(float(v)), 6),
            "annualized": round(math.sqrt(float(v)) * ann_factor * 100, 4),
        }
        for k, v in enumerate(garch_var_fcast)
    ]

    # --- HAR-RV ---
    har = fit_har(log_ret)
    har_rv_fcast = har_forecast(har, horizon)
    har_current_vol = math.sqrt(har.current_rv) * ann_factor * 100

    har_fcast_list = [
        {
            "step": k + 1,
            "rv": round(float(rv), 8),
            "vol": round(math.sqrt(float(rv)), 6),
            "annualized": round(math.sqrt(float(rv)) * ann_factor * 100, 4),
        }
        for k, v in enumerate(har_rv_fcast)
        for rv in [max(v, 1e-12)]
    ]

    # --- Ансамбль: простое среднее двух моделей ---
    ensemble_fcast = [
        {
            "step": k + 1,
            "vol": round((g["vol"] + h["vol"]) / 2, 6),
            "annualized": round((g["annualized"] + h["annualized"]) / 2, 4),
        }
        for k, (g, h) in enumerate(zip(garch_fcast_list, har_fcast_list))
    ]

    return {
        "garch": {
            "current_vol": round(garch_current_vol, 4),
            "persistence": round(garch.persistence, 6),
            "half_life": round(garch.half_life, 2) if math.isfinite(garch.half_life) else None,
            "params": {
                "omega": round(garch.omega, 10),
                "alpha": round(garch.alpha, 6),
                "beta":  round(garch.beta,  6),
            },
            "forecast": garch_fcast_list,
        },
        "har": {
            "current_vol": round(har_current_vol, 4),
            "r_squared": round(har.r_squared, 4),
            "params": {
                "c":      round(har.c,       8),
                "beta_d": round(har.beta_d,  6),
                "beta_w": round(har.beta_w,  6),
                "beta_m": round(har.beta_m,  6),
            },
            "forecast": har_fcast_list,
        },
        "ensemble": {
            "forecast": ensemble_fcast,
        },
        "meta": {
            "n_bars": len(log_ret),
            "interval": interval,
            "bars_per_year": bpy,
            "horizon": horizon,
        },
    }


# =============================================================================
# Фичи для нейросети: GARCH и HAR как входные признаки
# =============================================================================
def add_vol_features(df: pd.DataFrame, interval: str = "1d") -> pd.DataFrame:
    """
    Добавляет в DataFrame признаки волатильности, вычисленные rolling-образом
    (без утечки: для бара t используются только данные до t включительно).

    Добавляемые колонки:
        garch_h      — условная дисперсия GARCH (нормирована к long-run)
        har_rv_d     — дневная RV (квадрат лог-доходности)
        har_rv_w     — скользящая недельная RV (mean за 5 баров)
        har_rv_m     — скользящая месячная RV (mean за 22 бара)
        vol_ratio_wm — отношение недельной к месячной RV (мера «режима»)
        vol_zscore   — z-score текущей RV относительно 63-барного окна
    """
    out = df.copy()
    log_ret = np.log(out["close"] / out["close"].shift(1))
    rv = log_ret ** 2  # квадрат лог-доходности как proxy RV

    out["har_rv_d"] = rv
    out["har_rv_w"] = rv.rolling(5).mean()
    out["har_rv_m"] = rv.rolling(22).mean()
    out["vol_ratio_wm"] = out["har_rv_w"] / (out["har_rv_m"] + 1e-12)

    # z-score RV в 63-барном окне
    rv_mean = rv.rolling(63).mean()
    rv_std  = rv.rolling(63).std()
    out["vol_zscore"] = (rv - rv_mean) / (rv_std + 1e-12)

    # GARCH h_t rolling: упрощённый EWMA как прокси (экспоненциальный GARCH ~RiskMetrics).
    # Полная рекурсивная оценка rolling GARCH слишком медленна для обучения,
    # поэтому используем λ=0.94 (стандарт RiskMetrics), что аппроксимирует GARCH(1,1)
    # с alpha≈0.06, beta≈0.94. Разница с MLE-GARCH обычно < 5% по прогнозу.
    lam = 0.94
    ewma_var = rv.ewm(alpha=1 - lam, adjust=False).mean()
    long_run_var = rv.rolling(250, min_periods=50).mean()
    out["garch_h"] = ewma_var / (long_run_var + 1e-12)  # нормировано к долгосрочному

    return out
