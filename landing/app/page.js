import Link from "next/link";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function Home() {
  return (
    <>
      <nav className="nav">
        <div className="nav-brand">Mantra <span>Trading</span></div>
        <div className="nav-links">
          <a href="#features">Возможности</a>
          <a href="#plans">Тарифы</a>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn-nav">Начать бесплатно</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <h1>ML-сигналы для<br /><span>любого рынка</span></h1>
        <p>
          Нейросеть BiLSTM + CNN + Attention анализирует паттерны акций, крипты,
          облигаций и форекса — и выдаёт точку входа, стоп и тейк.
        </p>
        <div className="hero-btns">
          <Link href="/register" className="btn-primary">Попробовать бесплатно</Link>
          <Link href="/login" className="btn-outline">Войти в терминал</Link>
        </div>
      </section>

      {/* STATS */}
      <section className="stats">
        {[
          ["5", "Классов активов"],
          ["3", "Таймфрейма"],
          ["Triple-Barrier", "Разметка целей"],
          ["GARCH + HAR-RV", "Волатильность"],
        ].map(([num, label]) => (
          <div key={label}>
            <div className="stat-num">{num}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </section>

      {/* FEATURES */}
      <section className="features" id="features">
        <h2 className="section-title">Что умеет терминал</h2>
        <p className="section-sub">Полный цикл от данных до торгового решения</p>
        <div className="features-grid">
          {[
            { icon: "🧠", title: "BiLSTM + CNN + Attention", desc: "Архитектура захватывает локальные паттерны через свёрточные слои и долгосрочные зависимости через двунаправленный LSTM с механизмом внимания." },
            { icon: "📊", title: "Triple-Barrier разметка", desc: "Цели обучения по методу Лопеса де Прадо: вероятность срабатывания тейка раньше стопа на горизонте 6–24 баров." },
            { icon: "📉", title: "GARCH + HAR-RV", desc: "Два независимых метода прогноза волатильности на горизонт 1–30 баров. Ансамблевое усреднение для устойчивости." },
            { icon: "🎯", title: "Классы активов", desc: "Отдельные модели для акций, крипты, облигаций, форекс и товарных активов. Автоматическая маршрутизация по тикеру." },
            { icon: "🔄", title: "Walk-forward бэктест", desc: "Скользящее окно обучения и тестирования без утечки данных. Equity curve, Sharpe, Calmar, максимальная просадка." },
            { icon: "🔌", title: "T-Invest / Bybit / FMP", desc: "Подключение к реальным данным: акции Мосбиржи через T-Invest API, крипта через Bybit, мировые рынки через FinancialData." },
          ].map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PLANS */}
      <section className="plans" id="plans">
        <h2 className="section-title">Доступ</h2>
        <p className="section-sub">Два уровня: сигналы для трейдера и полный контроль для администратора</p>
        <div className="plans-grid">
          <div className="plan-card">
            <div className="plan-name">User</div>
            <div className="plan-price">Бесплатно</div>
            <div className="plan-desc">Для трейдера — всё необходимое для торговли</div>
            <ul className="plan-features">
              <li>Торговые сигналы по любому тикеру</li>
              <li>OHLC-график с уровнями входа / SL / TP</li>
              <li>История всех прогнозов</li>
              <li>5 классов активов</li>
            </ul>
            <Link href="/register" className="btn-primary" style={{ display: "block", textAlign: "center" }}>
              Зарегистрироваться
            </Link>
          </div>
          <div className="plan-card featured">
            <div className="plan-name">Admin</div>
            <div className="plan-price">Полный доступ</div>
            <div className="plan-desc">Управление моделями и всей системой</div>
            <ul className="plan-features">
              <li>Всё из User</li>
              <li>Обучение нейросетей</li>
              <li>Walk-forward бэктест</li>
              <li>Управление источниками данных</li>
              <li>История всех пользователей</li>
              <li>Управление классами активов</li>
            </ul>
            <Link href="/login" className="btn-outline" style={{ display: "block", textAlign: "center" }}>
              Войти как admin
            </Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <nav className="footer-links">
            <Link href="/privacy">Политика конфиденциальности</Link>
            <Link href="/terms">Условия использования</Link>
            <Link href="/oferta">Публичная оферта</Link>
          </nav>
          <p className="footer-copy">
            © 2026 Mantra Trading · ML-торговый терминал<br />
            Не является финансовой рекомендацией. Торговля сопряжена с риском потери капитала.
          </p>
        </div>
      </footer>
    </>
  );
}
