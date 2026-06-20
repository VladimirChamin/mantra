"""
schedule_retrain.py
===================
Периодическое автоматическое дообучение модели.

Два способа использования:

1) Через встроенный планировщик APScheduler (процесс висит в фоне):
       python schedule_retrain.py --symbol BTC-USD --interval 1h --every-hours 24

2) Через системный cron (рекомендуется на сервере) — запускайте сам retrain:
       # каждый день в 02:00:
       0 2 * * *  cd /path/to/project && /usr/bin/python trading_nn.py retrain --symbol BTC-USD --interval 1h >> retrain.log 2>&1

Дообучение использует «тёплый старт»: модель не учится с нуля, а продолжает
от текущих весов на свежих данных, и сохраняет версионный снимок.
"""

import argparse
from datetime import datetime

from trading_nn import Config, retrain


def run_once(symbol: str, interval: str):
    cfg = Config(symbol=symbol, interval=interval)
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] Старт дообучения {cfg.tag}")
    try:
        retrain(cfg)
        print(f"[{datetime.now():%Y-%m-%d %H:%M}] Дообучение завершено успешно")
    except Exception as e:
        print(f"[{datetime.now():%Y-%m-%d %H:%M}] ОШИБКА дообучения: {e}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--symbol", default="BTC-USD")
    p.add_argument("--interval", default="1h")
    p.add_argument("--every-hours", type=int, default=24,
                   help="Период дообучения в часах")
    p.add_argument("--now", action="store_true",
                   help="Прогнать дообучение сразу один раз и выйти")
    args = p.parse_args()

    if args.now:
        run_once(args.symbol, args.interval)
        return

    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
    except ImportError:
        raise SystemExit("Установите APScheduler:  pip install APScheduler")

    sched = BlockingScheduler()
    sched.add_job(run_once, "interval", hours=args.every_hours,
                  args=[args.symbol, args.interval],
                  next_run_time=datetime.now())  # первый запуск сразу
    print(f"Планировщик запущен: дообучение {args.symbol} каждые {args.every_hours} ч. "
          f"Ctrl+C для остановки.")
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        print("Планировщик остановлен.")


if __name__ == "__main__":
    main()
