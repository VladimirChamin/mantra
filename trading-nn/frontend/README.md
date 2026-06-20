# Нейротерминал — фронтенд (Next.js)

Веб-интерфейс для управления торговой нейросетью: обучение, walk-forward
тестирование и получение сигналов (вход / стоп / тейк).

## Запуск

Сначала поднимите backend (в корне проекта):

```bash
pip install -r requirements.txt
uvicorn api_server:app --reload --port 8000
```

Затем фронтенд:

```bash
cd frontend
cp .env.local.example .env.local     # при необходимости поменяйте адрес API
npm install
npm run dev
```

Откройте http://localhost:3000

## Настройка адреса backend

В `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Что внутри

- `app/page.js` — дашборд с тремя вкладками: Обучение, Walk-forward, Сигнал.
- `components/SignalTicket.js` — «торговый тикет» с уровнями entry/SL/TP.
- `components/MetricGrid.js` — метрики бэктеста (винрейт, profit factor, просадка…).
- `components/EquityChart.js` — кривая капитала (SVG, без зависимостей).
- `components/JobLog.js` — прогресс и лог фоновой задачи.
- `lib/api.js` — клиент к backend.

Обучение и бэктест идут как фоновые задачи на сервере; интерфейс опрашивает их
статус и показывает прогресс по эпохам/фолдам в реальном времени.
