"""
walkforward.py
==============
Walk-forward тестирование нейросети из trading_nn.py.

Идея walk-forward (главный честный способ оценить торговую модель):
    окно за окном модель обучается ТОЛЬКО на прошлом и проверяется на следующем
    (невиданном) отрезке. Так мы имитируем реальную эксплуатацию, где модель
    периодически дообучается и торгует вперёд.

      [---- train ----][ test ]
            [---- train ----][ test ]
                  [---- train ----][ test ]   ...

Сделки симулируются честно:
    - вход по close сигнального бара;
    - SL/TP из прогноза волатильности (как в боевом predict_signal);
    - при одновременном касании SL и TP в одном баре считаем худшее (SL);
    - учитываются комиссия и проскальзывание;
    - без перекрытия позиций (одна сделка за раз).

Запуск:
    python walkforward.py --symbol BTC-USD --interval 1h --train-bars 3000 \
        --test-bars 500 --epochs 15
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

import trading_nn as tn


# =============================================================================
# Подготовка матриц признаков/целей/цен (один раз на всю историю)
# =============================================================================
def _prepare(df: pd.DataFrame, cfg: tn.Config):
    feats = tn.add_features(df).replace([np.inf, -np.inf], np.nan)
    p_up, fwd_ret, fwd_vol, valid = tn.triple_barrier_targets(feats, cfg)

    exclude = {"open", "high", "low", "close", "volume", "atr"}
    feature_cols = [c for c in feats.columns if c not in exclude]
    cfg.feature_cols = feature_cols

    X_raw = feats[feature_cols].to_numpy(dtype=np.float32)
    finite = np.isfinite(X_raw).all(axis=1)
    row_ok = finite & valid

    prices = {
        "close": df["close"].to_numpy(dtype=np.float64),
        "high": df["high"].to_numpy(dtype=np.float64),
        "low": df["low"].to_numpy(dtype=np.float64),
        "atr": feats["atr"].to_numpy(dtype=np.float64),
        "index": df.index,
    }
    return X_raw, row_ok, p_up, fwd_ret, fwd_vol, feature_cols, prices


def _make_sequences(X_scaled, row_ok, lookback, lo, hi, targets=None):
    """Окна, заканчивающиеся в [lo, hi). Возвращает X, индексы концов и (опц.) цели."""
    Xs, end_idx = [], []
    yp, yr, yv = [], [], []
    for t in range(max(lookback - 1, lo), hi):
        if not row_ok[t]:
            continue
        w = X_scaled[t - lookback + 1: t + 1]
        if not np.isfinite(w).all():
            continue
        Xs.append(w); end_idx.append(t)
        if targets is not None:
            yp.append(targets[0][t]); yr.append(targets[1][t]); yv.append(targets[2][t])
    Xs = np.asarray(Xs, dtype=np.float32)
    end_idx = np.asarray(end_idx, dtype=np.int64)
    if targets is not None:
        return Xs, end_idx, (np.asarray(yp, np.float32),
                             np.asarray(yr, np.float32),
                             np.asarray(yv, np.float32))
    return Xs, end_idx


# =============================================================================
# Симуляция одной сделки по сигналу
# =============================================================================
def _simulate_trade(t, side, prices, cfg, fwd_vol_pred,
                    commission=0.0005, slippage=0.0005):
    """Возвращает (net_return, exit_bar) или (None, t) если входа нет."""
    close, high, low, atr = prices["close"], prices["high"], prices["low"], prices["atr"]
    n = len(close)
    entry = close[t]
    vol_abs = max(fwd_vol_pred * entry, 0.2 * atr[t])
    sl_dist = cfg.sl_atr_mult * vol_abs
    tp_dist = cfg.tp_atr_mult * vol_abs

    if side > 0:  # LONG
        tp, sl = entry + tp_dist, entry - sl_dist
    else:         # SHORT
        tp, sl = entry - tp_dist, entry + sl_dist

    exit_price, exit_bar = None, min(t + cfg.horizon, n - 1)
    for j in range(t + 1, min(t + cfg.horizon, n - 1) + 1):
        hit_sl = (low[j] <= sl) if side > 0 else (high[j] >= sl)
        hit_tp = (high[j] >= tp) if side > 0 else (low[j] <= tp)
        if hit_sl and hit_tp:        # консервативно: сначала стоп
            exit_price, exit_bar = sl, j
            break
        if hit_sl:
            exit_price, exit_bar = sl, j
            break
        if hit_tp:
            exit_price, exit_bar = tp, j
            break
    if exit_price is None:           # таймаут — выходим по close
        exit_price = close[exit_bar]

    gross = side * (exit_price - entry) / entry
    net = gross - 2 * commission - 2 * slippage   # вход + выход
    return net, exit_bar


# =============================================================================
# Метрики по списку доходностей сделок
# =============================================================================
def _metrics(returns: list[float]) -> dict:
    if not returns:
        return {"n_trades": 0, "win_rate": 0, "profit_factor": 0,
                "total_return": 0, "sharpe": 0, "max_drawdown": 0, "expectancy": 0}
    r = np.array(returns)
    wins, losses = r[r > 0], r[r <= 0]
    gross_profit = wins.sum()
    gross_loss = -losses.sum()
    equity = np.cumprod(1 + r)
    peak = np.maximum.accumulate(equity)
    dd = (equity - peak) / peak
    return {
        "n_trades": int(len(r)),
        "win_rate": round(float(len(wins) / len(r)), 4),
        "avg_win": round(float(wins.mean()) if len(wins) else 0, 5),
        "avg_loss": round(float(losses.mean()) if len(losses) else 0, 5),
        "profit_factor": round(float(gross_profit / (gross_loss + 1e-9)), 3),
        "expectancy": round(float(r.mean()), 5),
        "total_return": round(float(equity[-1] - 1), 4),
        "sharpe": round(float(r.mean() / (r.std() + 1e-9)), 3),  # на сделку
        "max_drawdown": round(float(dd.min()), 4),
    }


# =============================================================================
# Основной walk-forward цикл
# =============================================================================
def walk_forward(cfg: tn.Config, train_bars=3000, test_bars=500, epochs=15,
                 anchored=False, commission=0.0005, slippage=0.0005,
                 df: pd.DataFrame | None = None, on_progress=None) -> dict:
    """
    anchored=False  -> скользящее окно (train фиксированной длины)
    anchored=True   -> расширяющееся окно (train растёт от начала)
    """
    if df is None:
        df = tn.load_ohlcv(cfg)
    X_raw, row_ok, p_up, fwd_ret, fwd_vol, feature_cols, prices = _prepare(df, cfg)
    n = len(df)
    L = cfg.lookback

    # границы фолдов
    folds = []
    start = 0
    train_end = train_bars
    while train_end + test_bars <= n:
        tr_start = 0 if anchored else max(0, train_end - train_bars)
        folds.append((tr_start, train_end, train_end + test_bars))
        train_end += test_bars
    if not folds:
        raise ValueError(f"Недостаточно данных: {n} баров. Уменьшите train-bars/test-bars.")

    all_returns, equity_points, fold_reports = [], [], []
    equity = 1.0

    from sklearn.preprocessing import StandardScaler
    from tensorflow.keras.callbacks import EarlyStopping

    for fi, (tr_s, tr_e, te_e) in enumerate(folds):
        if on_progress:
            on_progress(fi / len(folds), f"Фолд {fi + 1}/{len(folds)}: обучение")

        # масштабирование по train-строкам фолда
        scaler = StandardScaler()
        tr_rows = row_ok.copy()
        tr_rows[:tr_s] = False
        tr_rows[tr_e:] = False
        if tr_rows.sum() < 100:
            continue
        scaler.fit(np.nan_to_num(X_raw[tr_rows]))
        X_scaled = scaler.transform(np.nan_to_num(X_raw))

        Xtr, _, ytr = _make_sequences(X_scaled, row_ok, L, tr_s, tr_e,
                                      targets=(p_up, fwd_ret, fwd_vol))
        if len(Xtr) < 50:
            continue

        model = tn.build_model(L, Xtr.shape[-1], cfg)
        # балансировка p_up через sample_weight
        pos = ytr[0].mean()
        wp, wn = 0.5 / (pos + 1e-9), 0.5 / (1 - pos + 1e-9)
        sw = np.where(ytr[0] == 1, wp, wn).astype(np.float32)
        ones = np.ones_like(sw)
        model.fit(Xtr, [ytr[0], ytr[1], ytr[2]],
                  sample_weight=[sw, ones, ones],
                  epochs=epochs, batch_size=cfg.batch_size, verbose=0,
                  callbacks=[EarlyStopping(monitor="loss", patience=4,
                                           restore_best_weights=True)])

        # сигналы на тестовом отрезке
        Xte, end_te = _make_sequences(X_scaled, row_ok, L, tr_e, te_e)
        if on_progress:
            on_progress((fi + 0.5) / len(folds), f"Фолд {fi + 1}/{len(folds)}: тест")
        if len(Xte) == 0:
            continue
        preds = model.predict(Xte, verbose=0)
        pup, fret, fvol = preds[0][:, 0], preds[1][:, 0], preds[2][:, 0]

        fold_returns = []
        next_free = tr_e
        for k, t in enumerate(end_te):
            if t < next_free:               # позиция ещё открыта — пропускаем
                continue
            side = 0
            if pup[k] >= cfg.prob_threshold and fret[k] > 0:
                side = 1
            elif (1 - pup[k]) >= cfg.prob_threshold and fret[k] < 0:
                side = -1
            if side == 0:
                continue
            rr = cfg.tp_atr_mult / max(cfg.sl_atr_mult, 1e-9)
            if rr < cfg.min_rr:
                continue
            net, exit_bar = _simulate_trade(int(t), side, prices, cfg, float(fvol[k]),
                                            commission, slippage)
            if net is None:
                continue
            fold_returns.append(net)
            all_returns.append(net)
            equity *= (1 + net)
            equity_points.append({"time": str(prices["index"][exit_bar]),
                                  "equity": round(equity, 5)})
            next_free = exit_bar             # запрет перекрытия

        fr = _metrics(fold_returns)
        fr["fold"] = fi + 1
        fr["train_range"] = [str(prices["index"][tr_s]), str(prices["index"][tr_e - 1])]
        fr["test_range"] = [str(prices["index"][tr_e]), str(prices["index"][te_e - 1])]
        fold_reports.append(fr)

    overall = _metrics(all_returns)
    if on_progress:
        on_progress(1.0, "Готово")

    return {
        "symbol": cfg.symbol,
        "interval": cfg.interval,
        "config": {"train_bars": train_bars, "test_bars": test_bars,
                   "epochs": epochs, "anchored": anchored, "horizon": cfg.horizon,
                   "commission": commission, "slippage": slippage},
        "overall": overall,
        "folds": fold_reports,
        "equity_curve": equity_points,
        "n_folds": len(fold_reports),
    }


def parse_args():
    p = argparse.ArgumentParser(description="Walk-forward backtest для trading_nn")
    p.add_argument("--symbol", default="BTC-USD")
    p.add_argument("--interval", default="1h")
    p.add_argument("--period", default="730d")
    p.add_argument("--train-bars", type=int, default=3000)
    p.add_argument("--test-bars", type=int, default=500)
    p.add_argument("--epochs", type=int, default=15)
    p.add_argument("--anchored", action="store_true")
    return p.parse_args()


def main():
    a = parse_args()
    cfg = tn.Config(symbol=a.symbol, interval=a.interval, period=a.period)
    res = walk_forward(cfg, train_bars=a.train_bars, test_bars=a.test_bars,
                       epochs=a.epochs, anchored=a.anchored)
    print("\n=== WALK-FORWARD РЕЗУЛЬТАТ ===")
    print(json.dumps(res["overall"], indent=2, ensure_ascii=False))
    print(f"\nФолдов: {res['n_folds']}, сделок всего: {res['overall']['n_trades']}")


if __name__ == "__main__":
    main()
