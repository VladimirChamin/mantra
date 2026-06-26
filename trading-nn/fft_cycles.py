"""
fft_cycles.py
=============
Анализ природных циклов цен через FFT и экстраполяция вперёд.

Алгоритм:
  1. Берём log-returns за lookback баров (устраняем тренд и нестационарность)
  2. Применяем FFT с окном Хэннинга (подавляет спектральные утечки)
  3. Отбираем топ-K доминирующих частот по амплитуде
  4. Экстраполируем каждую гармонику на horizon баров вперёд
  5. Суммируем гармоники → прогнозная траектория возвратов
  6. Конвертируем обратно в абсолютные цены от последней известной цены
"""
from __future__ import annotations

import numpy as np
from typing import Optional


def _hann_window(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)


def analyze_cycles(
    closes: np.ndarray,
    horizon: int = 10,
    top_k: int = 5,
    min_period: int = 3,
    max_period_frac: float = 0.5,
) -> dict:
    """
    Анализирует циклы в ряде цен и экстраполирует вперёд.

    Parameters
    ----------
    closes      : массив цен закрытия (минимум 32 значения)
    horizon     : сколько баров вперёд экстраполировать
    top_k       : сколько доминирующих гармоник использовать
    min_period  : минимальный период цикла в барах (фильтр шума)
    max_period_frac: максимальный период как доля от длины ряда

    Returns
    -------
    {
        "fft_forecast": [{"bar": 1, "price": ...}, ...],   # цены вперёд
        "cycles": [{"period_bars": N, "amplitude_pct": X, "phase_deg": Y}, ...],
        "dominant_period": N,   # главный цикл в барах
        "r2": float,            # качество аппроксимации на истории [0..1]
    }
    """
    closes = np.asarray(closes, dtype=float)
    n = len(closes)
    if n < 16:
        return {"fft_forecast": [], "cycles": [], "dominant_period": None, "r2": 0.0}

    # 1. Log-returns + убираем линейный тренд
    returns = np.diff(np.log(closes))
    m = len(returns)
    trend = np.polyfit(np.arange(m), returns, 1)
    detrended = returns - np.polyval(trend, np.arange(m))

    # 2. FFT с окном Хэннинга
    window = _hann_window(m)
    spectrum = np.fft.rfft(detrended * window)
    freqs = np.fft.rfftfreq(m)

    amplitudes = np.abs(spectrum) * 2 / m  # нормировка
    phases = np.angle(spectrum)

    # 3. Фильтруем: период от min_period до max_period баров
    max_period = int(m * max_period_frac)
    valid = []
    for i, f in enumerate(freqs):
        if f <= 0:
            continue
        period = 1.0 / f
        if min_period <= period <= max_period:
            valid.append((i, period, amplitudes[i], phases[i]))

    if not valid:
        return {"fft_forecast": [], "cycles": [], "dominant_period": None, "r2": 0.0}

    # 4. Топ-K по амплитуде
    valid.sort(key=lambda x: -x[2])
    top = valid[:top_k]

    # 5. Реконструкция на истории для оценки R²
    reconstructed = np.zeros(m)
    for idx, period, amp, phase in top:
        f = freqs[idx]
        reconstructed += amp * np.cos(2 * np.pi * f * np.arange(m) + phase)

    ss_res = np.sum((detrended - reconstructed) ** 2)
    ss_tot = np.sum((detrended - detrended.mean()) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    r2 = max(0.0, min(1.0, r2))

    # 6. Экстраполяция вперёд
    # Продолжаем тренд returns и суммируем гармоники
    future_idx = np.arange(m, m + horizon)
    future_returns = np.polyval(trend, future_idx)  # тренд
    for idx, period, amp, phase in top:
        f = freqs[idx]
        future_returns += amp * np.cos(2 * np.pi * f * future_idx + phase)

    # 7. Конвертируем обратно в цены
    price0 = float(closes[-1])
    fft_prices = []
    p = price0
    for i, r in enumerate(future_returns):
        # мягкое ограничение: не даём уходить дальше ±15% от старта за горизонт
        r_clamped = float(np.clip(r, -0.05, 0.05))
        p = p * np.exp(r_clamped)
        fft_prices.append({"bar": i + 1, "price": round(p, 4)})

    # 8. Описание найденных циклов
    price_mean = float(closes.mean())
    cycles_info = []
    for idx, period, amp, phase in top:
        # амплитуда в % от средней цены (приближённо через масштаб returns)
        amp_pct = round(float(amp) * 100, 3)
        cycles_info.append({
            "period_bars": round(period, 1),
            "amplitude_pct": amp_pct,
            "phase_deg": round(float(np.degrees(phase)), 1),
        })

    dominant = cycles_info[0]["period_bars"] if cycles_info else None

    return {
        "fft_forecast": fft_prices,
        "cycles": cycles_info,
        "dominant_period": dominant,
        "r2": round(r2, 3),
    }


def label_cycle(period_bars: float, interval: str) -> str:
    """Человекочитаемое название цикла."""
    bars_per_day = {"1d": 1, "4h": 6, "1h": 24}.get(interval, 1)
    days = period_bars / bars_per_day
    if days < 5:
        return f"{period_bars:.0f} баров"
    if days < 14:
        return f"~{days:.0f} дн ({period_bars:.0f} баров)"
    if days < 35:
        return f"~{days/7:.1f} нед ({period_bars:.0f} баров)"
    if days < 100:
        return f"~{days/30:.1f} мес ({period_bars:.0f} баров)"
    return f"~{days/365:.1f} лет ({period_bars:.0f} баров)"
