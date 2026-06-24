"""
api_server.py
=============
HTTP-бэкенд (FastAPI), который связывает нейросеть trading_nn с веб-интерфейсом
на Next.js. Обучение и бэктест выполняются как фоновые задачи с прогрессом.

Запуск:
    pip install fastapi "uvicorn[standard]"
    uvicorn api_server:app --reload --port 8000

Эндпоинты (все под /api):
    GET  /api/health                  состояние сервера и источника данных
    GET  /api/models                  список обученных моделей
    POST /api/datasource              переключить источник (yfinance | tinvest)
    POST /api/train                   запустить обучение (фоновая задача)
    POST /api/backtest                запустить walk-forward (фоновая задача)
    POST /api/predict                 получить торговый сигнал (синхронно)
    GET  /api/jobs                     список задач
    GET  /api/jobs/{id}                статус/результат задачи
"""

from __future__ import annotations

import os
import threading
import traceback
import uuid
from datetime import datetime
from typing import Optional
from pathlib import Path

# загружаем .env из директории скрипта
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            _v = _v.strip().strip('"').strip("'")
            os.environ.setdefault(_k.strip(), _v)

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

import tensorflow as tf

import trading_nn as tn
import walkforward as wf
import volatility as vol_module
import auth
import ai_analysis as ai_mod
import subscriptions as subs_mod

app = FastAPI(title="Trading NN Control API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# инициализируем БД при старте
auth.init_db()
subs_mod.init_subscriptions_db()


def _forecast_for_sub(symbol: str, interval: str) -> dict:
    """Вызывается из фонового сканера подписок."""
    cfg = tn.make_config(symbol, interval)
    active = auth.get_active_models()
    return tn.forecast(cfg, steps=5, history=50,
                       active_tags=active if active else None)


subs_mod.set_forecast_fn(_forecast_for_sub)
subs_mod.start_scanner()

# Активируем мультироутер: crypto→Bybit, stocks→T-Invest/yfinance, forex/commodity→yfinance
import multi_loader as _ml
_ml.activate()
_STATE = {"data_source": "auto"}

# =============================================================================
# Монитор качества моделей (AUC watchdog)
# =============================================================================
_AUC_MONITOR = {
    "enabled":        False,
    "interval_hours": 6,
    "warn_threshold": tn.AUC_THRESHOLD_WARN,
    "last_check":     None,
}
_AUC_MONITOR_LOCK = threading.Lock()
_AUC_MONITOR_THREAD: threading.Thread | None = None


def _auc_monitor_loop():
    """Фоновый поток: периодически проверяет AUC всех моделей."""
    import time
    while True:
        with _AUC_MONITOR_LOCK:
            cfg = dict(_AUC_MONITOR)

        if not cfg["enabled"]:
            time.sleep(60)
            continue

        interval_sec = max(cfg["interval_hours"], 1) * 3600
        time.sleep(interval_sec)

        _run_auc_check(cfg)


def _run_auc_check(cfg: dict | None = None):
    """Пересчитывает AUC всех моделей."""
    if cfg is None:
        with _AUC_MONITOR_LOCK:
            cfg = dict(_AUC_MONITOR)

    all_metrics = tn.get_all_metrics()
    for m in all_metrics:
        tag = m["tag"]
        try:
            tn.refresh_model_metrics(tag)
            with _AUC_MONITOR_LOCK:
                _AUC_MONITOR["last_check"] = datetime.now().isoformat(timespec="seconds")
        except Exception as e:
            print(f"[auc_monitor] {tag}: {e}")


def _ensure_monitor_thread():
    global _AUC_MONITOR_THREAD
    if _AUC_MONITOR_THREAD is None or not _AUC_MONITOR_THREAD.is_alive():
        _AUC_MONITOR_THREAD = threading.Thread(
            target=_auc_monitor_loop, daemon=True, name="auc-monitor")
        _AUC_MONITOR_THREAD.start()


# =============================================================================
# Менеджер фоновых задач
# =============================================================================
class JobManager:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self._cancel_flags: dict[str, threading.Event] = {}
        self.lock = threading.Lock()

    def create(self, kind: str, params: dict) -> str:
        jid = uuid.uuid4().hex[:12]
        with self.lock:
            self.jobs[jid] = {
                "id": jid, "kind": kind, "status": "queued",
                "progress": 0.0, "logs": [], "result": None, "error": None,
                "params": params, "created": datetime.now().isoformat(timespec="seconds"),
            }
            self._cancel_flags[jid] = threading.Event()
        return jid

    def update(self, jid: str, **kw):
        with self.lock:
            if jid in self.jobs:
                self.jobs[jid].update(kw)

    def log(self, jid: str, msg: str):
        with self.lock:
            if jid in self.jobs:
                self.jobs[jid]["logs"].append(
                    f"{datetime.now():%H:%M:%S} {msg}")

    def get(self, jid: str) -> Optional[dict]:
        with self.lock:
            return self.jobs.get(jid)

    def list(self) -> list:
        with self.lock:
            return sorted(self.jobs.values(), key=lambda j: j["created"], reverse=True)

    def cancel(self, jid: str) -> bool:
        """Устанавливает флаг отмены. Возвращает False если задача не найдена или уже завершена."""
        with self.lock:
            job = self.jobs.get(jid)
            if not job or job["status"] in ("done", "error", "cancelled"):
                return False
            self._cancel_flags[jid].set()
            job["status"] = "cancelling"
        return True

    def is_cancelled(self, jid: str) -> bool:
        with self.lock:
            ev = self._cancel_flags.get(jid)
        return ev.is_set() if ev else False

    def cancel_event(self, jid: str):
        """Возвращает threading.Event флага отмены для передачи в train()."""
        with self.lock:
            return self._cancel_flags.get(jid)


JOBS = JobManager()


def _run_async(target, *args):
    threading.Thread(target=target, args=args, daemon=True).start()


# =============================================================================
# Auth модели
# =============================================================================
class RegisterReq(BaseModel):
    email: str
    name: str = ""
    password: str
    role: str = "user"

class LoginReq(BaseModel):
    email: str
    password: str


# =============================================================================
# Модели запросов
# =============================================================================
class TrainReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    period: Optional[str] = None
    epochs: int = 40
    horizon: Optional[int] = None
    lookback: Optional[int] = None
    warm_start: bool = False
    entry_offset_mult: Optional[float] = None  # 0 = маркет, >0 = BUYSTOP/SELLSTOP


class BacktestReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    period: Optional[str] = None
    train_bars: Optional[int] = None
    test_bars: Optional[int] = None
    epochs: int = 15
    horizon: Optional[int] = None
    lookback: Optional[int] = None
    anchored: bool = False
    commission: float = 0.0005
    slippage: float = 0.0005


class PredictReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    period: Optional[str] = None


class ForecastReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    period: Optional[str] = None
    steps: int = 10
    history: int = 50


class VolatilityReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    period: Optional[str] = None
    horizon: int = 30


class TrainUniversalReq(BaseModel):
    symbols: list[str] = []
    asset_class: str = "stocks"
    interval: str = "1d"
    epochs: int = 40
    period: Optional[str] = None
    entry_offset_mult: Optional[float] = None
    horizon: Optional[int] = None
    lookback: Optional[int] = None
    warm_start: bool = False
    direction_filter: str = "both"
    excluded_features: list[str] = []


class FeatureImportanceReq(BaseModel):
    symbol: str = ""
    interval: str = "1d"
    n_repeats: int = 3


class AnalysisReq(BaseModel):
    symbol: str
    interval: str = "1d"
    signal_direction: str = "UNKNOWN"
    signal_entry: Optional[float] = None
    company_hint: str = ""
    signal_id: Optional[int] = None


# =============================================================================
# Фоновые исполнители
# =============================================================================
def _make_stop_callback(jid: str, total_epochs: int):
    """Keras callback: проверяет флаг отмены после каждой эпохи."""
    class _StopCB(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            ep = epoch + 1
            JOBS.update(jid, progress=round(ep / max(total_epochs, 1), 3))
            val_loss = logs.get("val_loss", float("nan"))
            val_auc  = logs.get("val_p_up_auc", logs.get("val_auc", float("nan")))
            lr       = float(self.model.optimizer.learning_rate
                             if not callable(self.model.optimizer.learning_rate)
                             else self.model.optimizer.learning_rate(self.model.optimizer.iterations))
            JOBS.log(jid, f"эпоха {ep}/{total_epochs} "
                          f"val_loss={val_loss:.4f} "
                          f"val_auc={val_auc:.4f}")
            # накапливаем числовые данные для графика
            with JOBS.lock:
                job = JOBS.jobs.get(jid)
                if job is not None:
                    if "epoch_data" not in job:
                        job["epoch_data"] = []
                    job["epoch_data"].append({
                        "epoch": ep,
                        "total": total_epochs,
                        "val_loss": round(float(val_loss), 5) if val_loss == val_loss else None,
                        "val_auc":  round(float(val_auc),  5) if val_auc  == val_auc  else None,
                        "lr":       round(lr, 7),
                    })
            if JOBS.is_cancelled(jid):
                self.model.stop_training = True
    return _StopCB()


def _do_train(jid: str, req: TrainReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Обучение {req.symbol} {req.interval}, эпох={req.epochs}")
    try:
        cfg = tn.make_config(req.symbol, req.interval, period=req.period,
                             epochs=req.epochs, horizon=req.horizon, lookback=req.lookback,
                             entry_offset_mult=req.entry_offset_mult)
        mode = "BUYSTOP/SELLSTOP" if cfg.entry_offset_mult > 0 else "Маркет"
        JOBS.log(jid, f"горизонт={cfg.horizon} окно={cfg.lookback} история={cfg.period} вход={mode}")

        tn.train(cfg, warm_start=req.warm_start,
                 extra_callbacks=[_make_stop_callback(jid, req.epochs)],
                 cancel_event=JOBS.cancel_event(jid))

        if JOBS.is_cancelled(jid):
            JOBS.update(jid, status="cancelled", progress=JOBS.get(jid)["progress"])
            JOBS.log(jid, "Обучение остановлено пользователем")
            return

        signal = tn.predict_signal(cfg)
        JOBS.update(jid, status="done", progress=1.0,
                    result={"message": "Модель обучена и сохранена", "signal": signal})
        JOBS.log(jid, "Готово")
    except Exception as e:
        tb = traceback.format_exc()
        JOBS.update(jid, status="error", error=f"{type(e).__name__}: {e}")
        JOBS.log(jid, f"ОШИБКА: {type(e).__name__}: {e}")
        for line in tb.splitlines()[-8:]:
            JOBS.log(jid, line)
        traceback.print_exc()


def _do_train_universal(jid: str, req: TrainUniversalReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Универсальное обучение: {len(req.symbols)} инструментов, "
                  f"интервал={req.interval}, эпох={req.epochs}")
    try:
        asset_class = req.asset_class.upper()
        symbols = req.symbols or tn.ASSET_CLASS_META.get(
            req.asset_class.lower(), {}).get("default_symbols", [])
        mode = "BUYSTOP/SELLSTOP" if (req.entry_offset_mult or 0) > 0 else "Маркет"
        period_str = req.period or "(пресет)"
        JOBS.log(jid, f"вход={mode} история={period_str}")
        tn.train_universal(
            symbols=symbols,
            interval=req.interval,
            epochs=req.epochs,
            asset_class=asset_class,
            extra_callbacks=[_make_stop_callback(jid, req.epochs)],
            log_fn=lambda msg: JOBS.log(jid, msg),
            cancel_event=JOBS.cancel_event(jid),
            entry_offset_mult=req.entry_offset_mult,
            period=req.period,
            horizon=req.horizon,
            lookback=req.lookback,
            direction_filter=req.direction_filter or "both",
            excluded_features=req.excluded_features or [],
        )

        if JOBS.is_cancelled(jid):
            JOBS.update(jid, status="cancelled", progress=JOBS.get(jid)["progress"])
            JOBS.log(jid, "Обучение остановлено пользователем")
            return

        JOBS.update(jid, status="done", progress=1.0,
                    result={"message": f"Модель класса {asset_class} обучена на {len(symbols)} инструментах",
                            "asset_class": asset_class, "symbols": symbols, "interval": req.interval})
        JOBS.log(jid, "Готово")
    except Exception as e:
        tb = traceback.format_exc()
        JOBS.update(jid, status="error", error=f"{type(e).__name__}: {e}")
        JOBS.log(jid, f"ОШИБКА: {type(e).__name__}: {e}")
        for line in tb.splitlines()[-8:]:
            JOBS.log(jid, line)
        traceback.print_exc()


def _do_feature_importance(jid: str, req: FeatureImportanceReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Feature importance {req.symbol} {req.interval}, повторений={req.n_repeats}")
    try:
        cfg = tn.make_config(req.symbol, req.interval)
        JOBS.log(jid, "Загружаю данные и модель…")
        results = tn.compute_feature_importance(cfg, n_repeats=req.n_repeats)
        top10 = results[:10]
        JOBS.log(jid, "Топ-10 признаков: " +
                 ", ".join(f"{r['feature']} ({r['importance']:+.4f})" for r in top10))
        JOBS.update(jid, status="done", progress=1.0,
                    result={"features": results, "top10": top10})
        JOBS.log(jid, "Готово")
    except Exception as e:
        JOBS.update(jid, status="error", error=str(e))
        JOBS.log(jid, f"ОШИБКА: {e}")
        traceback.print_exc()


def _do_backtest(jid: str, req: BacktestReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Walk-forward {req.symbol} {req.interval}")
    try:
        cfg = tn.make_config(req.symbol, req.interval, period=req.period,
                             horizon=req.horizon, lookback=req.lookback)
        win = tn.BACKTEST_PRESETS.get(req.interval, {"train_bars": 3000, "test_bars": 500})
        train_bars = req.train_bars or win["train_bars"]
        test_bars = req.test_bars or win["test_bars"]
        JOBS.log(jid, f"окна: train={train_bars} test={test_bars} горизонт={cfg.horizon}")

        def progress(frac, msg):
            JOBS.update(jid, progress=round(float(frac), 3))
            JOBS.log(jid, msg)
            return JOBS.is_cancelled(jid)

        def on_fold(fold_idx, total_folds, metrics):
            entry = {
                "fold":           fold_idx,
                "total":          total_folds,
                "total_return":   round(metrics.get("total_return", 0.0) * 100, 2),
                "profit_factor":  round(metrics.get("profit_factor", 0.0), 3),
                "win_rate":       round(metrics.get("win_rate", 0.0) * 100, 1),
                "n_trades":       metrics.get("n_trades", 0),
                "max_drawdown":   round(metrics.get("max_drawdown", 0.0) * 100, 2),
                "recovery_factor": round(metrics.get("recovery_factor", 0.0), 3),
            }
            with JOBS.lock:
                job = JOBS.jobs.get(jid)
                if job is not None:
                    if "fold_data" not in job:
                        job["fold_data"] = []
                    job["fold_data"].append(entry)
            ret_s = f"{entry['total_return']:+.1f}%" if entry['total_return'] is not None else "—"
            JOBS.log(jid, f"[chart] фолд {fold_idx}/{total_folds} доход={ret_s} PF={entry['profit_factor']:.2f} сделок={entry['n_trades']}")

        res = wf.walk_forward(cfg, train_bars=train_bars, test_bars=test_bars,
                              epochs=req.epochs, anchored=req.anchored,
                              commission=req.commission, slippage=req.slippage,
                              on_progress=progress, on_fold=on_fold)

        if JOBS.is_cancelled(jid):
            JOBS.update(jid, status="cancelled", progress=JOBS.get(jid)["progress"])
            JOBS.log(jid, "Walk-forward остановлен пользователем")
            return

        ov = res["overall"]
        pf  = ov.get("profit_factor", 0)
        rf  = ov.get("recovery_factor", 0)
        wr  = ov.get("win_rate", 0)
        n   = ov.get("n_trades", 0)

        # вердикт по порогам
        THRESHOLDS = {"min_trades": 10, "min_pf": 1.3, "min_rf": 2.0, "min_wr": 0.45}
        verdict_ok = (n >= THRESHOLDS["min_trades"] and
                      pf >= THRESHOLDS["min_pf"] and
                      rf >= THRESHOLDS["min_rf"] and
                      wr >= THRESHOLDS["min_wr"])
        verdict_str = "✓ ГОДНА" if verdict_ok else "✗ НЕ ПРОШЛА"
        res["verdict"] = {
            "ok": verdict_ok,
            "label": verdict_str,
            "thresholds": THRESHOLDS,
            "pf": round(pf, 3), "rf": round(rf, 3),
            "wr": round(wr, 4), "n_trades": n,
        }

        # сохраняем результат в файл рядом с моделью
        try:
            actual_tag = tn.resolve_model_tag(req.symbol, req.interval)
            wf_path = os.path.join("models", f"{actual_tag}_wf_result.json")
            import json as _json
            with open(wf_path, "w") as _f:
                _json.dump(res, _f, indent=2, ensure_ascii=False)
        except Exception:
            pass

        JOBS.update(jid, status="done", progress=1.0, result=res)
        JOBS.log(jid, f"Готово: сделок={n} доходность={ov['total_return']*100:.1f}% "
                      f"PF={pf:.2f} RF={rf:.2f} WR={wr*100:.0f}%")
        JOBS.log(jid, f"Вердикт: {verdict_str} "
                      f"(PF≥{THRESHOLDS['min_pf']} RF≥{THRESHOLDS['min_rf']} "
                      f"WR≥{THRESHOLDS['min_wr']*100:.0f}% сделок≥{THRESHOLDS['min_trades']})")
    except Exception as e:
        JOBS.update(jid, status="error", error=str(e))
        JOBS.log(jid, f"ОШИБКА: {e}")
        traceback.print_exc()


# =============================================================================
# Эндпоинты
# =============================================================================

# --- Auth ---
@app.post("/api/auth/register", tags=["auth"])
def register(req: RegisterReq):
    try:
        user = auth.create_user(req.email, req.name, req.password, req.role)
        token = auth.create_token(user)
        return {"token": token, "user": _safe_user(user)}
    except ValueError as e:
        raise HTTPException(400, str(e))

@app.post("/api/auth/login", tags=["auth"])
def login(req: LoginReq):
    user = auth.get_user_by_email(req.email)
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Неверный email или пароль")
    token = auth.create_token(user)
    return {"token": token, "user": _safe_user(user)}

@app.get("/api/auth/me", tags=["auth"])
def me(user: dict = Depends(auth.get_current_user)):
    return _safe_user(user)

@app.get("/api/auth/users", tags=["auth"])
def users_list(user: dict = Depends(auth.require_admin)):
    return {"users": auth.list_users()}


class ResetPasswordReq(BaseModel):
    email: str


@app.post("/api/auth/reset-password", tags=["auth"])
def reset_password(req: ResetPasswordReq):
    """Генерирует новый пароль и отправляет его на почту. Всегда возвращает 200."""
    try:
        masked = auth.reset_password(req.email)
        return {"ok": True, "message": f"Если аккаунт существует, письмо отправлено на {masked}"}
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


class PatchUserReq(BaseModel):
    ai_quota: Optional[int] = None
    access_until: Optional[str] = None   # ISO datetime или "" для снятия лимита
    role: Optional[str] = None


@app.patch("/api/auth/users/{uid}", tags=["auth"])
def patch_user(uid: int, req: PatchUserReq, _=Depends(auth.require_admin)):
    """Изменить квоту, дату доступа или роль пользователя."""
    try:
        if req.ai_quota is not None:
            auth.update_user_quota(uid, req.ai_quota)
        if req.access_until is not None:
            until = req.access_until.strip() or None
            auth.update_user_access(uid, until)
        if req.role is not None:
            auth.update_user_role(uid, req.role)
        user = auth.get_user_by_id(uid)
        if not user:
            raise HTTPException(404, "Пользователь не найден")
        return user
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/auth/users/{uid}", tags=["auth"])
def remove_user(uid: int, admin: dict = Depends(auth.require_admin)):
    if uid == admin["id"]:
        raise HTTPException(400, "Нельзя удалить самого себя")
    user = auth.get_user_by_id(uid)
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    auth.delete_user(uid)
    return {"ok": True}

@app.delete("/api/auth/me", tags=["auth"])
def delete_own_account(user: dict = Depends(auth.get_current_user)):
    """Удаление собственного аккаунта со всеми данными."""
    auth.delete_user(user["id"])
    return {"ok": True}

def _safe_user(u: dict) -> dict:
    return {k: u[k] for k in ("id", "email", "name", "role", "created_at") if k in u}

# --- История сигналов ---
@app.get("/api/signals", tags=["signals"])
def my_signals(user: dict = Depends(auth.get_current_user)):
    rows = auth.get_signals(user["id"])
    return {"signals": rows}

@app.get("/api/signals/all", tags=["signals"])
def all_signals(user: dict = Depends(auth.require_admin)):
    return {"signals": auth.get_all_signals()}


@app.delete("/api/signals/{signal_id}", tags=["signals"])
def delete_signal(signal_id: int, user: dict = Depends(auth.get_current_user)):
    ok = auth.delete_signal(signal_id, user["id"])
    if not ok:
        raise HTTPException(404, "Сигнал не найден")
    return {"ok": True}


class AdminTokensReq(BaseModel):
    tinvest_token: Optional[str] = None
    fd_key: Optional[str] = None

@app.get("/api/admin/tokens")
def get_admin_tokens(reveal: bool = False, user: dict = Depends(auth.require_admin)):
    if reveal:
        return {
            "tinvest_token": os.environ.get("TINVEST_TOKEN", "") or None,
            "fd_key": os.environ.get("FINANCIALDATA_API_KEY", "") or None,
        }
    return {
        "tinvest_token_set": bool(os.environ.get("TINVEST_TOKEN", "").strip()),
        "fd_key_set": bool(os.environ.get("FINANCIALDATA_API_KEY", "").strip()),
    }

@app.post("/api/admin/tokens")
def set_admin_tokens(req: AdminTokensReq, user: dict = Depends(auth.require_admin)):
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    # читаем .env
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []

    def set_env_var(lines, key, value):
        new_line = f"{key}={value}\n"
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = new_line
                return lines
        lines.append(new_line)
        return lines

    if req.tinvest_token:
        os.environ["TINVEST_TOKEN"] = req.tinvest_token
        lines = set_env_var(lines, "TINVEST_TOKEN", req.tinvest_token)
        import multi_loader as _ml
        _ml.activate()  # перерегистрируем с новым токеном

    if req.fd_key:
        os.environ["FINANCIALDATA_API_KEY"] = req.fd_key
        lines = set_env_var(lines, "FINANCIALDATA_API_KEY", req.fd_key)

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

    return {"ok": True}


@app.get("/api/health")
def health():
    models = _list_models()
    return {"status": "ok", "data_source": _STATE["data_source"],
            "models": len(models), "time": datetime.now().isoformat(timespec="seconds")}


@app.get("/api/meta")
def meta():
    """Инструменты Мосбиржи, таймфреймы и пресеты — для автозаполнения форм."""
    return {
        "instruments": tn.MOEX_INSTRUMENTS,
        "intervals": ["1d", "4h"],
        "presets": tn.TIMEFRAME_PRESETS,
        "backtest_presets": tn.BACKTEST_PRESETS,
    }


def _list_models() -> list:
    d = "models"
    if not os.path.isdir(d):
        return []
    out = []
    for f in os.listdir(d):
        if f.endswith("_model.keras"):
            tag = f[:-len("_model.keras")]
            path = os.path.join(d, f)
            st = os.stat(path)
            parts = tag.rsplit("_", 1)
            out.append({
                "tag": tag,
                "symbol": parts[0] if len(parts) == 2 else tag,
                "interval": parts[1] if len(parts) == 2 else "",
                "size_kb": round(st.st_size / 1024, 1),
                "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            })
    return sorted(out, key=lambda m: m["modified"], reverse=True)


@app.get("/api/models")
def models():
    return {"models": _list_models()}


@app.get("/api/asset_classes")
def asset_classes():
    """Возвращает реестр классов активов: мета + какие модели уже обучены."""
    result = {}
    for cls, meta in tn.ASSET_CLASS_META.items():
        trained = {}
        for iv in tn.TIMEFRAME_PRESETS.keys():
            tag = tn.class_model_tag(cls.upper(), iv)
            model_path = os.path.join("models", f"{tag}_model.keras")
            trained[iv] = os.path.exists(model_path)
        result[cls] = {**meta, "trained": trained}
    return result


@app.get("/api/asset_classes/{symbol}")
def detect_asset_class_for_symbol(symbol: str):
    """Определяет класс актива и какая модель будет использована для тикера."""
    cls = tn.detect_asset_class(symbol)
    try:
        model_tag = tn.resolve_model_tag(symbol, "1d")
    except FileNotFoundError:
        model_tag = None
    return {
        "symbol": symbol.upper(),
        "asset_class": cls,
        "label": tn.ASSET_CLASS_META.get(cls, {}).get("label", cls),
        "model_tag": model_tag,
    }


@app.post("/api/train")
def start_train(req: TrainReq):
    jid = JOBS.create("train", req.model_dump())
    _run_async(_do_train, jid, req)
    return {"job_id": jid}


@app.post("/api/train_universal")
def start_train_universal(req: TrainUniversalReq):
    jid = JOBS.create("train_universal", req.model_dump())
    _run_async(_do_train_universal, jid, req)
    return {"job_id": jid}


@app.post("/api/backtest")
def start_backtest(req: BacktestReq):
    jid = JOBS.create("backtest", req.model_dump())
    _run_async(_do_backtest, jid, req)
    return {"job_id": jid}


@app.post("/api/feature_importance", tags=["models"])
def start_feature_importance(req: FeatureImportanceReq,
                              user: dict = Depends(auth.require_admin)):
    """Запускает расчёт permutation feature importance в фоне."""
    jid = JOBS.create("feature_importance", req.model_dump())
    _run_async(_do_feature_importance, jid, req)
    return {"job_id": jid}


@app.get("/api/feature_importance", tags=["models"])
def get_feature_importance(symbol: str, interval: str = "1d",
                           user: dict = Depends(auth.require_admin)):
    """Возвращает последний сохранённый результат feature importance (если есть)."""
    cfg = tn.make_config(symbol, interval)
    fi = tn.load_feature_importance(cfg)
    if fi is None:
        raise HTTPException(404, "Данные feature importance не найдены. Запустите расчёт.")
    return fi


@app.get("/api/features/all", tags=["models"])
def all_features(interval: str = "1d", _=Depends(auth.require_admin)):
    """Все доступные признаки, сгруппированные по категориям."""
    return {"groups": tn.get_all_feature_names(interval)}


@app.get("/api/features/{tag}", tags=["models"])
def get_excluded(tag: str, _=Depends(auth.require_admin)):
    """Список отключённых признаков для конкретной модели."""
    return {"excluded": tn.get_model_excluded_features(tag)}


class ExcludedFeaturesReq(BaseModel):
    excluded: list[str] = []


@app.post("/api/features/{tag}", tags=["models"])
def set_excluded(tag: str, req: ExcludedFeaturesReq, _=Depends(auth.require_admin)):
    """Сохраняет список отключённых признаков в config.json модели."""
    try:
        tn.set_model_excluded_features(tag, req.excluded)
        return {"ok": True, "excluded": req.excluded}
    except FileNotFoundError:
        raise HTTPException(404, f"Модель {tag} не найдена")


@app.post("/api/predict")
def predict(req: PredictReq):
    cfg = tn.make_config(req.symbol, req.interval, period=req.period)
    try:
        return tn.predict_signal(cfg)
    except FileNotFoundError:
        raise HTTPException(404, "Модель не найдена. Сначала обучите её.")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/forecast")
def forecast(
    req: ForecastReq,
    current_user: dict = Depends(auth.get_current_user),
):
    cfg = tn.make_config(req.symbol, req.interval, period=req.period)
    try:
        active = auth.get_active_models()  # [] = все активны
        result = tn.forecast(cfg, steps=req.steps, history=req.history,
                             active_tags=active if active else None)
        # сохраняем сигнал в историю вместе с данными для графика
        if result.get("signal"):
            import json as _json
            sig = dict(result["signal"])
            sig["interval"] = req.interval
            fc_json = _json.dumps({
                "history":     result.get("history", []),
                "forecast":    result.get("forecast", []),
                "levels":      result.get("levels"),
                "last_price":  result.get("last_price"),
                "signal":      result.get("signal"),
                "pivot_levels": result.get("pivot_levels"),
                "indicators":  result.get("indicators"),
            })
            explanation = sig.get("explanation")
            expl_json = _json.dumps(explanation, ensure_ascii=False) if explanation else None
            auth.save_signal(current_user["id"], sig, forecast_json=fc_json,
                             explanation_json=expl_json)
        return result
    except FileNotFoundError:
        raise HTTPException(404, "Модель не найдена. Сначала обучите её или активируйте нужную модель в разделе «Нейросети».")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/actuals", tags=["signals"])
def get_actuals(
    symbol: str,
    interval: str = "1d",
    from_time: str = "",   # ISO datetime — начало (последний исторический бар прогноза)
    steps: int = 10,
    # параметры сигнала для автоматической оценки статуса
    signal_direction: str = "",   # LONG / SHORT
    signal_entry: float = 0.0,
    signal_sl: float = 0.0,
    signal_tp: float = 0.0,
    current_user: dict = Depends(auth.get_current_user),
):
    """
    Возвращает реальные OHLCV-бары после даты прогноза для сравнения с прогнозным графиком.
    Если переданы параметры сигнала — дополнительно вычисляет статус: active/filled/invalidated/expired.
    """
    try:
        cfg = tn.make_config(symbol, interval)
        df  = tn.load_ohlcv(cfg)
        if from_time:
            try:
                dt = pd.Timestamp(from_time)
                if df.index.tz is not None and dt.tzinfo is None:
                    dt = dt.tz_localize(df.index.tz)
                elif df.index.tz is None and dt.tzinfo is not None:
                    dt = dt.tz_localize(None)
                df = df[df.index > dt]
            except Exception:
                return {"bars": [], "signal_status": None}
        else:
            return {"bars": [], "signal_status": None}
        df = df.head(steps + 1)
        bars = [
            {
                "time":  str(ts),
                "open":  round(float(row.open),  2),
                "high":  round(float(row.high),  2),
                "low":   round(float(row.low),   2),
                "close": round(float(row.close), 2),
            }
            for ts, row in df.iterrows()
        ]

        # ── Автоматическая оценка статуса сигнала ─────────────────────────
        signal_status = None
        if signal_direction in ("LONG", "SHORT") and signal_sl and signal_tp and len(df):
            status = "active"
            invalidated_at = None
            filled_at = None
            expired = len(df) >= steps  # горизонт истёк

            for ts, row in df.iterrows():
                if signal_direction == "LONG":
                    if float(row.close) < signal_sl:
                        status = "invalidated"
                        invalidated_at = str(ts)
                        break
                    if float(row.high) >= signal_tp:
                        status = "filled"
                        filled_at = str(ts)
                        break
                else:  # SHORT
                    if float(row.close) > signal_sl:
                        status = "invalidated"
                        invalidated_at = str(ts)
                        break
                    if float(row.low) <= signal_tp:
                        status = "filled"
                        filled_at = str(ts)
                        break

            if status == "active" and expired:
                status = "expired"

            signal_status = {
                "status": status,           # active | invalidated | filled | expired
                "invalidated_at": invalidated_at,
                "filled_at": filled_at,
                "bars_elapsed": len(df),
                "bars_total": steps,
            }

        return {"bars": bars, "signal_status": signal_status}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/ai_quota", tags=["analysis"])
def ai_quota(current_user: dict = Depends(auth.get_current_user)):
    """Текущий остаток AI-запросов пользователя."""
    return auth.get_ai_quota_info(current_user)


@app.post("/api/analysis", tags=["analysis"])
def run_analysis(
    req: AnalysisReq,
    current_user: dict = Depends(auth.get_current_user),
):
    """
    Фундаментальный AI-анализ: COT, новости (Google Search + скрапинг), DeepSeek.
    Возвращает verdict — подтверждает / противоречит / нейтрально к сигналу нейросети.
    User: 10 запросов в месяц. Admin: без лимита.
    """
    ok, used, limit = auth.check_ai_quota(current_user)
    if not ok:
        raise HTTPException(429, f"Исчерпан лимит AI-анализа: {used}/{limit} в этом месяце")

    # определяем класс актива для передачи в модуль
    asset_class = tn.detect_asset_class(req.symbol)

    try:
        result = ai_mod.run_analysis(
            symbol=req.symbol,
            signal_direction=req.signal_direction,
            signal_entry=req.signal_entry,
            company_hint=req.company_hint,
            asset_class=asset_class,
        )
    except Exception as e:
        raise HTTPException(500, str(e))

    # списываем квоту только при успешном завершении
    auth.consume_ai_quota(current_user["id"], req.symbol)
    # сохраняем результат в БД (привязываем к signal_id если передан)
    analysis_id = auth.save_ai_analysis(current_user["id"], result, signal_id=req.signal_id)
    result["analysis_id"] = analysis_id
    result["quota"] = auth.get_ai_quota_info(current_user)
    return result


@app.get("/api/signals/{signal_id}/analysis", tags=["analysis"])
def get_signal_analysis(signal_id: int, current_user: dict = Depends(auth.get_current_user)):
    """Возвращает сохранённый AI-анализ для конкретного сигнала (или null)."""
    result = auth.get_ai_analysis_by_signal(signal_id, current_user["id"])
    return {"result": result}


@app.get("/api/analyses", tags=["analysis"])
def list_analyses(current_user: dict = Depends(auth.get_current_user)):
    """История AI-анализов текущего пользователя (последние 20)."""
    return {"analyses": auth.get_ai_analyses(current_user["id"])}


@app.get("/api/analyses/{analysis_id}", tags=["analysis"])
def get_analysis(analysis_id: int, current_user: dict = Depends(auth.get_current_user)):
    """Полный результат AI-анализа по id."""
    result = auth.get_ai_analysis(analysis_id, current_user["id"])
    if not result:
        raise HTTPException(404, "Анализ не найден")
    return result


@app.delete("/api/analyses/{analysis_id}", tags=["analysis"])
def delete_analysis(analysis_id: int, current_user: dict = Depends(auth.get_current_user)):
    """Удаляет AI-анализ текущего пользователя."""
    deleted = auth.delete_ai_analysis(analysis_id, current_user["id"])
    if not deleted:
        raise HTTPException(404, "Анализ не найден")
    return {"ok": True}


@app.post("/api/volatility")
def volatility(req: VolatilityReq):
    """
    Прогноз волатильности GARCH(1,1) + HAR-RV на горизонт 1..30 баров.
    Не требует обученной нейросети — работает на сырых OHLCV данных.
    """
    cfg = tn.make_config(req.symbol, req.interval, period=req.period)
    try:
        df = tn.load_ohlcv(cfg)
        result = vol_module.volatility_forecast(df, interval=req.interval,
                                               horizon=req.horizon)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/jobs")
def jobs():
    # без полей result/logs для лёгкости списка
    return {"jobs": [{k: v for k, v in j.items() if k not in ("result", "logs")}
                     for j in JOBS.list()]}


@app.get("/api/jobs/{jid}")
def job(jid: str):
    j = JOBS.get(jid)
    if not j:
        raise HTTPException(404, "Задача не найдена")
    return j


@app.post("/api/jobs/{jid}/cancel", tags=["jobs"])
def cancel_job(jid: str, user: dict = Depends(auth.require_admin)):
    """Запрашивает остановку фоновой задачи (train / backtest)."""
    ok = JOBS.cancel(jid)
    if not ok:
        raise HTTPException(400, "Задача не найдена или уже завершена")
    return {"ok": True, "job_id": jid, "status": "cancelling"}


# =============================================================================
# Смена пароля
# =============================================================================
class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/change-password", tags=["auth"])
def change_password(req: ChangePasswordReq, current_user: dict = Depends(auth.get_current_user)):
    if not auth.verify_password(req.current_password, current_user["password_hash"]):
        raise HTTPException(400, "Неверный текущий пароль")
    if len(req.new_password) < 6:
        raise HTTPException(400, "Новый пароль должен быть не короче 6 символов")
    import bcrypt
    ph = bcrypt.hashpw(req.new_password.encode(), bcrypt.gensalt()).decode()
    with auth._con() as con:
        con.execute("UPDATE users SET password_hash=? WHERE id=?", (ph, current_user["id"]))
        con.commit()
    return {"ok": True, "message": "Пароль успешно изменён"}


# =============================================================================
# Подписки на сигналы
# =============================================================================
class SubscriptionReq(BaseModel):
    symbol: str
    interval: str = "1d"
    channel: str = "telegram"
    destination: str
    direction_filter: str = "any"
    min_prob: float = 0.55


class ToggleSubReq(BaseModel):
    active: bool


@app.get("/api/subscriptions", tags=["subscriptions"])
def get_subscriptions(current_user: dict = Depends(auth.get_current_user)):
    return {"subscriptions": subs_mod.list_subscriptions(current_user["id"])}


@app.post("/api/subscriptions", tags=["subscriptions"])
def add_subscription(req: SubscriptionReq, current_user: dict = Depends(auth.get_current_user)):
    try:
        sub = subs_mod.create_subscription(current_user["id"], req.model_dump())
        return sub
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/api/subscriptions/{sub_id}", tags=["subscriptions"])
def remove_subscription(sub_id: int, current_user: dict = Depends(auth.get_current_user)):
    ok = subs_mod.delete_subscription(sub_id, current_user["id"])
    if not ok:
        raise HTTPException(404, "Подписка не найдена")
    return {"ok": True}


@app.patch("/api/subscriptions/{sub_id}", tags=["subscriptions"])
def patch_subscription(sub_id: int, req: ToggleSubReq, current_user: dict = Depends(auth.get_current_user)):
    sub = subs_mod.toggle_subscription(sub_id, current_user["id"], req.active)
    if not sub:
        raise HTTPException(404, "Подписка не найдена")
    return sub


@app.put("/api/subscriptions/{sub_id}", tags=["subscriptions"])
def update_subscription(sub_id: int, req: SubscriptionReq, current_user: dict = Depends(auth.get_current_user)):
    sub = subs_mod.update_subscription(sub_id, current_user["id"], req.model_dump())
    if not sub:
        raise HTTPException(404, "Подписка не найдена")
    return sub


# =============================================================================
# Заметки
# =============================================================================

class NoteReq(BaseModel):
    title: str = ""
    body: str = ""
    color: str = "default"
    pinned: bool = False


@app.get("/api/notes", tags=["notes"])
def get_notes(current_user: dict = Depends(auth.get_current_user)):
    return auth.get_notes(current_user["id"])


@app.post("/api/notes", tags=["notes"])
def create_note(req: NoteReq, current_user: dict = Depends(auth.get_current_user)):
    return auth.create_note(current_user["id"], req.title, req.body, req.color)


@app.put("/api/notes/{note_id}", tags=["notes"])
def update_note(note_id: int, req: NoteReq, current_user: dict = Depends(auth.get_current_user)):
    note = auth.update_note(note_id, current_user["id"], req.title, req.body, req.color, req.pinned)
    if not note:
        raise HTTPException(404, "Заметка не найдена")
    return note


@app.delete("/api/notes/{note_id}", tags=["notes"])
def delete_note(note_id: int, current_user: dict = Depends(auth.get_current_user)):
    if not auth.delete_note(note_id, current_user["id"]):
        raise HTTPException(404, "Заметка не найдена")
    return {"ok": True}


# =============================================================================
# AUC Monitor эндпоинты
# =============================================================================

class AucMonitorSettingsReq(BaseModel):
    enabled: bool = False
    interval_hours: int = 6
    warn_threshold: float = 0.54


@app.get("/api/auc_monitor", tags=["models"])
def get_auc_monitor(_=Depends(auth.require_admin)):
    """Текущие настройки и статус монитора AUC."""
    with _AUC_MONITOR_LOCK:
        state = dict(_AUC_MONITOR)
    state["thread_alive"] = (_AUC_MONITOR_THREAD is not None and
                              _AUC_MONITOR_THREAD.is_alive())
    return state


@app.post("/api/auc_monitor", tags=["models"])
def set_auc_monitor(req: AucMonitorSettingsReq, _=Depends(auth.require_admin)):
    """Обновляет настройки монитора и (пере)запускает поток."""
    with _AUC_MONITOR_LOCK:
        _AUC_MONITOR.update({
            "enabled":        req.enabled,
            "interval_hours": req.interval_hours,
            "warn_threshold": req.warn_threshold,
        })
    if req.enabled:
        _ensure_monitor_thread()
    return {"ok": True}


@app.get("/api/models/metrics", tags=["models"])
def all_model_metrics(_=Depends(auth.require_admin)):
    """Возвращает AUC и статус для всех обученных моделей."""
    return {"metrics": tn.get_all_metrics()}


@app.delete("/api/models/{tag}", tags=["models"])
def delete_model(tag: str, _=Depends(auth.require_admin)):
    """Удаляет все файлы модели (.keras, .pkl, _config.json, _metrics.json, _feature_importance.json)."""
    model_dir = "models"
    suffixes = ["_model.keras", "_scaler.pkl", "_config.json",
                "_metrics.json", "_feature_importance.json"]
    deleted = []
    for suf in suffixes:
        path = os.path.join(model_dir, f"{tag}{suf}")
        if os.path.exists(path):
            os.remove(path)
            deleted.append(path)
    if not deleted:
        raise HTTPException(404, f"Модель {tag} не найдена")
    return {"ok": True, "deleted": deleted}


@app.post("/api/models/{tag}/refresh_metrics", tags=["models"])
def refresh_metrics(tag: str, _=Depends(auth.require_admin)):
    """Принудительно пересчитывает val AUC для модели (загружает данные и модель)."""
    try:
        result = tn.refresh_model_metrics(tag)
        return result
    except FileNotFoundError:
        raise HTTPException(404, f"Модель {tag} не найдена")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/auc_monitor/check_now", tags=["models"])
def check_auc_now(_=Depends(auth.require_admin)):
    """Немедленно запускает проверку AUC всех моделей в фоне."""
    _run_async(_run_auc_check)
    return {"ok": True, "message": "Проверка AUC запущена в фоне"}


# =============================================================================
# Активные модели (выбор для прогнозов)
# =============================================================================
class ActiveModelsReq(BaseModel):
    tags: list[str]


@app.get("/api/models/available", tags=["models"])
def get_available_intervals(symbol: str, current_user: dict = Depends(auth.get_current_user)):
    """Возвращает список таймфреймов для которых есть модель под данный символ."""
    active_tags = auth.get_active_models() or None
    available = []
    for iv in tn.TIMEFRAME_PRESETS.keys():
        try:
            tn.resolve_model_tag(symbol, iv, active_tags=active_tags)
            available.append(iv)
        except FileNotFoundError:
            pass
    return {"intervals": available}


@app.get("/api/active_models", tags=["models"])
def get_active_models(_=Depends(auth.require_admin)):
    return {"active": auth.get_active_models()}


@app.post("/api/active_models", tags=["models"])
def set_active_models(req: ActiveModelsReq, _=Depends(auth.require_admin)):
    auth.set_active_models(req.tags)
    return {"active": req.tags}


class WfActivateReq(BaseModel):
    symbol: str
    interval: str = "1d"
    min_pf: float = 1.3
    min_rf: float = 2.0
    min_wr: float = 0.45
    min_trades: int = 10
    force: bool = False   # активировать даже если не прошла пороги


@app.post("/api/models/activate_by_wf", tags=["models"])
def activate_by_wf(req: WfActivateReq, _=Depends(auth.require_admin)):
    """
    Читает последний WF-результат модели и активирует её если прошла пороги.
    force=True — активирует без проверки порогов.
    """
    try:
        tag = tn.resolve_model_tag(req.symbol, req.interval)
    except FileNotFoundError:
        raise HTTPException(404, f"Модель для {req.symbol} {req.interval} не найдена")

    wf_path = os.path.join("models", f"{tag}_wf_result.json")
    if not os.path.exists(wf_path):
        raise HTTPException(404, "WF-результат не найден. Сначала запустите walk-forward тест.")

    import json as _json
    with open(wf_path) as f:
        wf = _json.load(f)

    ov = wf.get("overall", {})
    pf = ov.get("profit_factor", 0)
    rf = ov.get("recovery_factor", 0)
    wr = ov.get("win_rate", 0)
    n  = ov.get("n_trades", 0)

    passed = (n >= req.min_trades and pf >= req.min_pf and
              rf >= req.min_rf and wr >= req.min_wr)

    if not passed and not req.force:
        return {
            "activated": False,
            "tag": tag,
            "reason": (f"Не прошла пороги: PF={pf:.2f} (нужно ≥{req.min_pf}), "
                       f"RF={rf:.2f} (нужно ≥{req.min_rf}), "
                       f"WR={wr*100:.0f}% (нужно ≥{req.min_wr*100:.0f}%), "
                       f"сделок={n} (нужно ≥{req.min_trades})"),
            "metrics": {"pf": pf, "rf": rf, "wr": wr, "n_trades": n},
        }

    # добавляем тег в active_models
    current = set(auth.get_active_models())
    current.add(tag)
    auth.set_active_models(list(current))

    return {
        "activated": True,
        "tag": tag,
        "forced": req.force and not passed,
        "metrics": {"pf": pf, "rf": rf, "wr": wr, "n_trades": n},
        "active": list(current),
    }


@app.post("/api/models/deactivate", tags=["models"])
def deactivate_model(req: WfActivateReq, _=Depends(auth.require_admin)):
    """Убирает модель из active_models."""
    try:
        tag = tn.resolve_model_tag(req.symbol, req.interval)
    except FileNotFoundError:
        raise HTTPException(404, f"Модель для {req.symbol} {req.interval} не найдена")
    current = set(auth.get_active_models())
    current.discard(tag)
    auth.set_active_models(list(current))
    return {"deactivated": True, "tag": tag, "active": list(current)}


# =============================================================================
# Скриннер — фоновое сканирование
# =============================================================================
SCREENER_WATCHLIST = [
    {"symbol": "BTCUSDT", "label": "Bitcoin",   "asset_class": "crypto"},
    {"symbol": "ETHUSDT", "label": "Ethereum",  "asset_class": "crypto"},
    {"symbol": "SOLUSDT", "label": "Solana",    "asset_class": "crypto"},
    {"symbol": "SBER",    "label": "Сбербанк",  "asset_class": "stocks"},
    {"symbol": "GAZP",    "label": "Газпром",   "asset_class": "stocks"},
    {"symbol": "LKOH",    "label": "Лукойл",    "asset_class": "stocks"},
    {"symbol": "NVTK",    "label": "Новатэк",   "asset_class": "stocks"},
    {"symbol": "YDEX",    "label": "Яндекс",    "asset_class": "stocks"},
    {"symbol": "XAUUSD",  "label": "Золото",    "asset_class": "commodity"},
    {"symbol": "XAGUSD",  "label": "Серебро",   "asset_class": "commodity"},
    {"symbol": "EURUSD",  "label": "EUR/USD",   "asset_class": "forex"},
    {"symbol": "GBPUSD",  "label": "GBP/USD",   "asset_class": "forex"},
    {"symbol": "USDJPY",  "label": "USD/JPY",   "asset_class": "forex"},
]


class ScreenerReq(BaseModel):
    interval: str = "1d"
    asset_class: str = "all"  # "all" | "crypto" | "stocks" | ...


def _run_screener(jid: str, interval: str, asset_class: str, user_id: int):
    items = [w for w in SCREENER_WATCHLIST
             if asset_class == "all" or w["asset_class"] == asset_class]
    total = len(items)
    results = []
    errors = []
    active_tags = auth.get_active_models() or None

    JOBS.update(jid, status="running", progress=0.0)

    for idx, item in enumerate(items):
        if JOBS.is_cancelled(jid):
            JOBS.update(jid, status="cancelled")
            return

        try:
            cfg = tn.make_config(item["symbol"], interval)
            res = tn.forecast(cfg, steps=10, history=50, active_tags=active_tags)
            if res.get("signal") and res["signal"].get("direction", "").upper() != "FLAT":
                sig = dict(res["signal"])
                sig.update({
                    "symbol":      item["symbol"],
                    "label":       item["label"],
                    "asset_class": item["asset_class"],
                    "interval":    interval,
                })
                results.append(sig)
                JOBS.update(jid, result={"results": results, "errors": errors})
        except Exception as e:
            errors.append({"symbol": item["symbol"], "msg": str(e)})
            JOBS.update(jid, result={"results": results, "errors": errors})

        progress = round(((idx + 1) / total) * 100)
        JOBS.update(jid, progress=progress,
                    result={"results": results, "errors": errors})
        JOBS.log(jid, f"{item['symbol']} — готово ({idx+1}/{total})")

    JOBS.update(jid, status="done", progress=100,
                result={"results": results, "errors": errors})


@app.post("/api/screener/start", tags=["screener"])
def screener_start(req: ScreenerReq, current_user: dict = Depends(auth.get_current_user)):
    jid = JOBS.create("screener", {"interval": req.interval, "asset_class": req.asset_class})
    _run_async(_run_screener, jid, req.interval, req.asset_class, current_user["id"])
    return {"job_id": jid}


@app.get("/api/screener/{jid}", tags=["screener"])
def screener_status(jid: str, current_user: dict = Depends(auth.get_current_user)):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "Задача не найдена")
    return {
        "job_id":   job["id"],
        "status":   job["status"],
        "progress": job["progress"],
        "result":   job.get("result") or {"results": [], "errors": []},
    }


@app.post("/api/screener/{jid}/cancel", tags=["screener"])
def screener_cancel(jid: str, current_user: dict = Depends(auth.get_current_user)):
    ok = JOBS.cancel(jid)
    if not ok:
        raise HTTPException(400, "Задача не найдена или уже завершена")
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=False)
