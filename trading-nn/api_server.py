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
            os.environ.setdefault(_k.strip(), _v.strip())

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
    return tn.forecast(cfg, steps=5, history=50)


subs_mod.set_forecast_fn(_forecast_for_sub)
subs_mod.start_scanner()

# текущий источник данных (для отображения в UI)
import os as _os
_tinvest_auto = bool(_os.environ.get("TINVEST_TOKEN", "").strip())
_STATE = {"data_source": "tinvest" if _tinvest_auto else "none"}


# =============================================================================
# Менеджер фоновых задач
# =============================================================================
class JobManager:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def create(self, kind: str, params: dict) -> str:
        jid = uuid.uuid4().hex[:12]
        with self.lock:
            self.jobs[jid] = {
                "id": jid, "kind": kind, "status": "queued",
                "progress": 0.0, "logs": [], "result": None, "error": None,
                "params": params, "created": datetime.now().isoformat(timespec="seconds"),
            }
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
    symbol: str = "IMOEX"
    interval: str = "1d"
    period: Optional[str] = None
    epochs: int = 40
    horizon: Optional[int] = None
    lookback: Optional[int] = None
    warm_start: bool = False


class BacktestReq(BaseModel):
    symbol: str = "IMOEX"
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
    symbol: str = "IMOEX"
    interval: str = "1d"
    period: Optional[str] = None


class ForecastReq(BaseModel):
    symbol: str = "IMOEX"
    interval: str = "1d"
    period: Optional[str] = None
    steps: int = 10
    history: int = 50


class VolatilityReq(BaseModel):
    symbol: str = "IMOEX"
    interval: str = "1d"
    period: Optional[str] = None
    horizon: int = 30


class TrainUniversalReq(BaseModel):
    symbols: list[str] = []
    asset_class: str = "stocks"
    interval: str = "1d"
    epochs: int = 40


class AnalysisReq(BaseModel):
    symbol: str
    interval: str = "1d"
    signal_direction: str = "UNKNOWN"
    signal_entry: Optional[float] = None
    company_hint: str = ""


class DataSourceReq(BaseModel):
    provider: str = "yfinance"           # 'yfinance' | 'tinvest' | 'bybit' | 'financialdata'
    token: Optional[str] = None          # T-Invest token
    api_key: Optional[str] = None        # FinancialData API key
    category: Optional[str] = "spot"    # Bybit: spot | linear | inverse


# =============================================================================
# Фоновые исполнители
# =============================================================================
def _do_train(jid: str, req: TrainReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Обучение {req.symbol} {req.interval}, эпох={req.epochs}")
    try:
        cfg = tn.make_config(req.symbol, req.interval, period=req.period,
                             epochs=req.epochs, horizon=req.horizon, lookback=req.lookback)
        JOBS.log(jid, f"горизонт={cfg.horizon} окно={cfg.lookback} история={cfg.period}")

        class ProgressCB(tf.keras.callbacks.Callback):
            def on_epoch_end(self, epoch, logs=None):
                logs = logs or {}
                JOBS.update(jid, progress=round((epoch + 1) / max(req.epochs, 1), 3))
                JOBS.log(jid, f"эпоха {epoch + 1}/{req.epochs} "
                              f"val_loss={logs.get('val_loss', float('nan')):.4f}")

        tn.train(cfg, warm_start=req.warm_start, extra_callbacks=[ProgressCB()])
        # сразу выдаём пробный сигнал
        signal = tn.predict_signal(cfg)
        JOBS.update(jid, status="done", progress=1.0,
                    result={"message": "Модель обучена и сохранена", "signal": signal})
        JOBS.log(jid, "Готово")
    except Exception as e:
        JOBS.update(jid, status="error", error=str(e))
        JOBS.log(jid, f"ОШИБКА: {e}")
        traceback.print_exc()


def _do_train_universal(jid: str, req: TrainUniversalReq):
    JOBS.update(jid, status="running")
    JOBS.log(jid, f"Универсальное обучение: {len(req.symbols)} инструментов, "
                  f"интервал={req.interval}, эпох={req.epochs}")
    try:
        class ProgressCB(tf.keras.callbacks.Callback):
            def on_epoch_end(self, epoch, logs=None):
                logs = logs or {}
                JOBS.update(jid, progress=round((epoch + 1) / max(req.epochs, 1), 3))
                JOBS.log(jid, f"эпоха {epoch + 1}/{req.epochs} "
                              f"val_loss={logs.get('val_loss', float('nan')):.4f}")

        asset_class = req.asset_class.upper()
        symbols = req.symbols or tn.ASSET_CLASS_META.get(
            req.asset_class.lower(), {}).get("default_symbols", [])
        tn.train_universal(
            symbols=symbols,
            interval=req.interval,
            epochs=req.epochs,
            asset_class=asset_class,
            extra_callbacks=[ProgressCB()],
            log_fn=lambda msg: JOBS.log(jid, msg),
        )
        JOBS.update(jid, status="done", progress=1.0,
                    result={"message": f"Модель класса {asset_class} обучена на {len(symbols)} инструментах",
                            "asset_class": asset_class, "symbols": symbols, "interval": req.interval})
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

        res = wf.walk_forward(cfg, train_bars=train_bars, test_bars=test_bars,
                              epochs=req.epochs, anchored=req.anchored,
                              commission=req.commission, slippage=req.slippage,
                              on_progress=progress)
        JOBS.update(jid, status="done", progress=1.0, result=res)
        JOBS.log(jid, f"Готово: сделок {res['overall']['n_trades']}, "
                      f"доходность {res['overall']['total_return']*100:.1f}%")
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
        "intervals": ["1d", "4h", "1h"],
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


@app.post("/api/datasource")
def set_datasource(req: DataSourceReq):
    if req.provider == "tinvest":
        import tinvest_loader
        token = req.token or os.environ.get("TINVEST_TOKEN")
        if not token:
            raise HTTPException(400, "Не задан токен T-Invest")
        tinvest_loader.use_tinvest(token)
        _STATE["data_source"] = "tinvest"

    elif req.provider == "bybit":
        import bybit_loader
        category = req.category or "spot"
        bybit_loader.use_bybit(category=category)
        _STATE["data_source"] = f"bybit/{category}"

    elif req.provider == "financialdata":
        import financialdata_loader
        api_key = req.api_key or os.environ.get("FINANCIALDATA_API_KEY")
        if not api_key:
            raise HTTPException(400, "Не задан API-ключ FinancialData")
        financialdata_loader.use_financialdata(api_key=api_key)
        _STATE["data_source"] = "financialdata"

    elif req.provider == "yfinance":
        tn.set_data_source(None)
        _STATE["data_source"] = "yfinance"

    else:
        raise HTTPException(400, f"Неизвестный источник: {req.provider}")

    return {"data_source": _STATE["data_source"]}


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
        result = tn.forecast(cfg, steps=req.steps, history=req.history)
        # сохраняем сигнал в историю
        if result.get("signal"):
            sig = dict(result["signal"])
            sig["interval"] = req.interval
            auth.save_signal(current_user["id"], sig)
        return result
    except FileNotFoundError:
        raise HTTPException(404, "Модель не найдена. Сначала обучите её.")
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
    result["quota"] = auth.get_ai_quota_info(current_user)
    return result


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


# =============================================================================
# Расписание переобучения (admin)
# =============================================================================
class RetrainSchedulesReq(BaseModel):
    schedules: list[dict]


class RetrainTriggerReq(BaseModel):
    interval: str = "1d"
    asset_class: Optional[str] = None


@app.get("/api/retrain/schedules", tags=["retrain"])
def get_retrain_schedules(_=Depends(auth.require_admin)):
    return {"schedules": subs_mod.get_retrain_schedules()}


@app.post("/api/retrain/schedules", tags=["retrain"])
def save_retrain_schedules(req: RetrainSchedulesReq, _=Depends(auth.require_admin)):
    subs_mod.save_retrain_schedules(req.schedules)
    return {"ok": True}


@app.get("/api/retrain/history", tags=["retrain"])
def retrain_history(_=Depends(auth.require_admin)):
    return {"history": subs_mod.get_retrain_history()}


@app.post("/api/retrain/trigger", tags=["retrain"])
def trigger_retrain(req: RetrainTriggerReq, _=Depends(auth.require_admin)):
    """Немедленно запускает переобучение модели для заданного таймфрейма."""
    interval = req.interval
    asset_class = req.asset_class or "stocks"

    # Берём символы из ASSET_CLASS_META
    meta = tn.ASSET_CLASS_META.get(asset_class.lower(), {})
    symbols = meta.get("default_symbols", [])
    symbols_str = " ".join(symbols) if symbols else asset_class

    train_req = TrainUniversalReq(
        symbols=symbols,
        asset_class=asset_class,
        interval=interval,
        epochs=20,
    )
    jid = JOBS.create("train_universal", train_req.model_dump())

    history_id = subs_mod.log_retrain(
        interval=interval, status="running",
        triggered_by="manual", job_id=jid,
        asset_class=asset_class, symbols=symbols_str
    )

    def _wrapped():
        _do_train_universal(jid, train_req)
        final_status = JOBS.get(jid).get("status", "done")
        subs_mod.update_retrain_status(history_id, final_status)

    _run_async(_wrapped)
    return {"job_id": jid, "history_id": history_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8000, reload=False)
