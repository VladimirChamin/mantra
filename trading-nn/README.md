# Trading NN — полный стек

Нейросеть (TensorFlow) для торговых сигналов + источник данных T-Invest +
walk-forward тестер + веб-интерфейс на Next.js.

```
Next.js (frontend/)        -> интерфейс: обучение / тесты / сигнал
        | HTTP /api
FastAPI (api_server.py)    -> фоновые задачи + статус
        |
trading_nn.py   walkforward.py   tinvest_loader.py
(модель GRU)    (бэктест)        (данные с Мосбиржи)
```

## Состав

| Файл | Назначение |
|------|-----------|
| `trading_nn.py` | модель, обучение, дообучение, инференс (entry/SL/TP) |
| `tinvest_loader.py` | загрузчик свечей через T-Invest API (Т-Банк) |
| `walkforward.py` | walk-forward бэктест с честной симуляцией сделок |
| `api_server.py` | HTTP-backend (FastAPI) для фронтенда |
| `schedule_retrain.py` | периодическое дообучение |
| `frontend/` | веб-интерфейс (Next.js) |

## Быстрый старт

```bash
# 1. зависимости Python
pip install -r requirements.txt

# 2. (опционально) данные T-Invest вместо yfinance.
#    SDK ставится из исходников (пакет в PyPI временно на карантине):
pip install "git+https://github.com/RussianInvestments/invest-python.git"
export TINVEST_TOKEN="t.xxxxx"     # токен из приложения Т-Инвестиции

# 3. backend
uvicorn api_server:app --reload --port 8000

# 4. frontend
cd frontend && npm install && npm run dev
# -> http://localhost:3000
```

## Без интерфейса (только CLI)

```bash
# индекс Мосбиржи, дневной таймфрейм (пресет применяется автоматически)
python trading_nn.py train    --symbol IMOEX --interval 1d
python trading_nn.py predict  --symbol IMOEX --interval 1d

# акция на H4 / H1
python trading_nn.py train    --symbol SBER  --interval 4h
python walkforward.py         --symbol SBER  --interval 1h
```

## Пресеты под таймфреймы Мосбиржи

Параметры подобраны под число баров в торговом дне (D1≈1, H4≈3, H1≈13):

| ТФ | Горизонт | Окно | История | Walk-forward (train/test) |
|----|----------|------|---------|---------------------------|
| 1d | 6 баров  | 50   | 6 лет   | 700 / 120 |
| 4h | 12 баров | 64   | 3 года  | 1500 / 300 |
| 1h | 24 бара  | 96   | 2 года  | 4000 / 700 |

Пресет можно переопределить флагами (`--horizon`, `--lookback`, `--period`)
или полями формы в интерфейсе.

## Источник данных T-Invest

`symbol` — тикер акции ("SBER", "GAZP"), индекс ("IMOEX", "RTSI") или FIGI/uid.
Индекс резолвится через справочник `indicatives()`, акция — через `find_instrument`
с приоритетом основного режима Мосбиржи (TQBR). Переключение источника — в
интерфейсе (карточка «Источник данных») или программно:

```python
import tinvest_loader, trading_nn
tinvest_loader.use_tinvest()                 # токен из TINVEST_TOKEN
cfg = trading_nn.make_config("IMOEX", "1d")  # пресет дневного ТФ
trading_nn.train(cfg)
```

> У индексов нет объёма и иногда нет внутридневных свечей — для IMOEX надёжнее
> всего дневной таймфрейм. У акций доступны D1/H4/H1.

## Важно

Это образовательный инструмент. Результаты бэктеста — оценка, а не гарантия
прибыли. Перед реальной торговлей обязательны проверка на свежих данных, учёт
всех издержек и строгий риск-менеджмент. Это не инвестиционная рекомендация.
