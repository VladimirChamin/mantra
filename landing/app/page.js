import Link from "next/link";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export default function Home() {
  return (
    <>
      {/* NAV */}
      <nav className="nav">
        <div className="nav-brand">Mantra <span>Trading</span></div>
        <div className="nav-links">
          <a href="#about">О проекте</a>
          <a href="#features">Возможности</a>
          <a href="#plans">Тарифы</a>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn-nav">Начать бесплатно</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-badge">Нейросетевой ML-терминал</div>
        <h1>Торговые сигналы<br /><span>на основе ИИ</span></h1>
        <p>
          BiLSTM + CNN + Attention анализирует акции, крипту, облигации, форекс
          и товарные активы — и выдаёт точку входа, стоп-лосс и тейк-профит.
          Подтверждение от DeepSeek AI на основе новостей и COT-позиций.
        </p>
        <div className="hero-btns">
          <Link href="/register" className="btn-primary">Попробовать бесплатно →</Link>
          <Link href="/login" className="btn-outline">Войти в терминал</Link>
        </div>
        <div className="hero-note">
          Бесплатно · Без карты · 10 AI-анализов в месяц
        </div>
      </section>

      {/* STATS */}
      <section className="stats">
        {[
          ["5", "Классов активов"],
          ["3", "Таймфрейма"],
          ["Triple-Barrier", "Метод разметки"],
          ["GARCH + HAR-RV", "Прогноз волатильности"],
          ["DeepSeek AI", "Фундаментальный анализ"],
        ].map(([num, label]) => (
          <div key={label} className="stat-item">
            <div className="stat-num">{num}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </section>

      {/* ABOUT */}
      <section className="about" id="about">
        <div className="container">
          <div className="about-grid">
            <div className="about-text">
              <span className="about-eyebrow">О проекте</span>
              <h2>Что такое Mantra Trading</h2>
              <p>
                Mantra Trading — персональный ML-терминал для анализа финансовых рынков.
                Система обучает нейронные сети на исторических данных и генерирует
                структурированные торговые сигналы с уровнями входа, стопа и тейка.
              </p>
              <p>
                В отличие от простых индикаторов, здесь работает полноценная нейросеть
                архитектуры <strong>BiLSTM + CNN + Multi-Head Attention</strong>,
                обученная методом разметки <strong>Triple-Barrier</strong> по Лопесу де Прадо.
                Это значит, что модель учится не предсказывать цену, а оценивать вероятность
                достижения тейка раньше стопа.
              </p>
              <p>
                Каждый сигнал проходит проверку через <strong>AI-аналитику</strong>:
                DeepSeek изучает свежие новости по активу, данные COT (позиции крупных
                игроков от CFTC) и макрофон — и выносит вердикт: подтверждает ли
                фундаментальная картина технический сигнал.
              </p>
            </div>
            <div className="about-cards">
              {[
                { icon: "🧠", label: "Нейросеть", desc: "BiLSTM + CNN + Attention на TensorFlow" },
                { icon: "📰", label: "Новости", desc: "Google Search + полный текст статей" },
                { icon: "📊", label: "COT данные", desc: "Позиции крупных игроков (CFTC API)" },
                { icon: "🎯", label: "Сигнал", desc: "Вход / Стоп / Тейк + вердикт ИИ" },
              ].map(c => (
                <div className="about-card" key={c.label}>
                  <span className="about-card-icon">{c.icon}</span>
                  <div>
                    <div className="about-card-label">{c.label}</div>
                    <div className="about-card-desc">{c.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="howto">
        <div className="container">
          <h2 className="section-title">Как это работает</h2>
          <p className="section-sub">От данных до торгового решения за несколько секунд</p>
          <div className="steps">
            {[
              { n: "1", title: "Данные", desc: "Загружаем OHLCV-историю через T-Invest, Bybit или Yahoo Finance. Поддержка таймфреймов 1D, 4H, 1H." },
              { n: "2", title: "Модель", desc: "Нейросеть анализирует последние 50 свечей: паттерны через CNN, временные зависимости через BiLSTM, внимание на ключевые бары." },
              { n: "3", title: "Сигнал", desc: "Система выдаёт направление (LONG/SHORT/FLAT), точку входа, ATR-стоп и тейк. Уровни рассчитываются от реальной волатильности." },
              { n: "4", title: "AI-проверка", desc: "DeepSeek анализирует новости и COT-позиции. Вердикт: ПОДТВЕРЖДАЕТ / ПРОТИВОРЕЧИТ / НЕЙТРАЛЬНО к сигналу нейросети." },
            ].map(s => (
              <div className="step" key={s.n}>
                <div className="step-num">{s.n}</div>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features" id="features">
        <h2 className="section-title">Возможности терминала</h2>
        <p className="section-sub">Полный цикл от данных до торгового решения</p>
        <div className="features-grid">
          {[
            { icon: "🧠", title: "BiLSTM + CNN + Attention", desc: "Архитектура захватывает локальные паттерны через свёрточные слои и долгосрочные зависимости через двунаправленный LSTM с механизмом внимания." },
            { icon: "📊", title: "Triple-Barrier разметка", desc: "Цели обучения по методу Лопеса де Прадо: вероятность срабатывания тейка раньше стопа на горизонте 6–24 баров." },
            { icon: "📉", title: "GARCH + HAR-RV", desc: "Два независимых метода прогноза волатильности на горизонт 1–30 баров. Ансамблевое усреднение для устойчивости." },
            { icon: "🤖", title: "DeepSeek AI-аналитика", desc: "Фундаментальный анализ: свежие новости через Google Search, позиции COT (CFTC), Fear&Greed. Вердикт подтверждает или опровергает сигнал нейросети." },
            { icon: "🔄", title: "Walk-forward бэктест", desc: "Скользящее окно обучения и тестирования без утечки данных. Equity curve, Sharpe, Calmar, максимальная просадка." },
            { icon: "🎯", title: "5 классов активов", desc: "Отдельные модели для акций, крипты, облигаций, форекс и товарных активов (металлы, энергетика, агро). Автоматическая маршрутизация по тикеру." },
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
              <li>AI-аналитика — 10 запросов в месяц</li>
              <li>История всех прогнозов</li>
              <li>5 классов активов</li>
            </ul>
            <Link href="/register" className="btn-primary" style={{ display: "block", textAlign: "center" }}>
              Зарегистрироваться →
            </Link>
          </div>
          <div className="plan-card featured">
            <div className="plan-name">Admin</div>
            <div className="plan-price">Полный доступ</div>
            <div className="plan-desc">Управление моделями и всей системой</div>
            <ul className="plan-features">
              <li>Всё из User</li>
              <li>AI-аналитика без лимита</li>
              <li>Обучение нейросетей</li>
              <li>Walk-forward бэктест</li>
              <li>Управление источниками данных</li>
              <li>Управление пользователями</li>
            </ul>
            <Link href="/login" className="btn-outline" style={{ display: "block", textAlign: "center" }}>
              Войти как admin
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="container">
          <h2>Готовы начать?</h2>
          <p>Регистрация занимает 30 секунд. Карта не нужна.</p>
          <div className="cta-btns">
            <Link href="/register" className="btn-primary">Создать аккаунт бесплатно</Link>
            <Link href="/login" className="btn-outline">Уже есть аккаунт — войти</Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
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
