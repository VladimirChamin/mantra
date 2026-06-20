import Link from "next/link";

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
        <div className="hero-badge">Торговые сигналы на базе искусственного интеллекта</div>
        <h1>Умные сигналы<br /><span>для вашей торговли</span></h1>
        <p>
          Искусственный интеллект анализирует акции, крипту, облигации, форекс
          и товарные активы — и выдаёт чёткую точку входа, стоп-лосс и тейк-профит.
          Каждый сигнал проходит проверку через новостной и фундаментальный анализ.
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
          ["5",   "Классов активов"],
          ["3",   "Таймфрейма"],
          ["24/7","Мониторинг рынка"],
          ["ИИ",  "Фундаментальный анализ"],
          ["10",  "AI-анализов в месяц бесплатно"],
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
                Mantra Trading — персональный торговый терминал с искусственным интеллектом.
                Система изучает историю рынка и генерирует структурированные сигналы
                с чёткими уровнями входа, стопа и тейка.
              </p>
              <p>
                В отличие от обычных индикаторов, здесь работает полноценный ИИ,
                который не просто рисует линии, а оценивает вероятность того,
                что цена достигнет цели раньше, чем сработает стоп.
              </p>
              <p>
                Каждый сигнал проходит дополнительную проверку: ИИ изучает свежие
                новости по активу, позиции крупных игроков и общий рыночный фон —
                и выносит вердикт: подтверждает ли фундаментальная картина сигнал.
              </p>
            </div>
            <div className="about-cards">
              {[
                { icon: "🧠", label: "ИИ-анализ", desc: "Искусственный интеллект обучен на миллионах исторических баров" },
                { icon: "📰", label: "Новости", desc: "Автоматический мониторинг свежих новостей по каждому активу" },
                { icon: "📊", label: "Крупные игроки", desc: "Анализ позиций институциональных участников рынка" },
                { icon: "🎯", label: "Сигнал", desc: "Вход / Стоп / Тейк + заключение ИИ по фундаменту" },
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
              { n: "1", title: "Данные",       desc: "Система загружает актуальную историю цен по выбранному активу и таймфрейму — дневной, 4-часовой или часовой." },
              { n: "2", title: "Анализ",        desc: "ИИ изучает последние свечи, выявляет паттерны и рыночные зависимости, оценивает вероятность движения цены." },
              { n: "3", title: "Сигнал",        desc: "Система выдаёт направление (покупка / продажа), точку входа и уровни стопа и тейка, рассчитанные от текущей волатильности." },
              { n: "4", title: "Проверка ИИ",   desc: "ИИ читает новости и анализирует позиции крупных игроков. Итог: подтверждает или опровергает сигнал с обоснованием." },
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
        <p className="section-sub">Всё необходимое для принятия взвешенных торговых решений</p>
        <div className="features-grid">
          {[
            { icon: "🧠", title: "Торговые сигналы на базе ИИ",   desc: "Искусственный интеллект анализирует рыночные данные и определяет моменты входа с высокой вероятностью отработки." },
            { icon: "📊", title: "Оценка вероятности",             desc: "Система показывает не просто направление, а вероятность достижения цели — вы сами решаете, входить или нет." },
            { icon: "📉", title: "Прогноз волатильности",          desc: "ИИ оценивает ожидаемую амплитуду движения и автоматически рассчитывает уровни стопа и тейка под текущий рынок." },
            { icon: "🤖", title: "Фундаментальный анализ ИИ",      desc: "Автоматический разбор свежих новостей, позиций крупных игроков и рыночного настроения — и краткое заключение по активу." },
            { icon: "🔄", title: "Исторический бэктест",           desc: "Проверка стратегии на исторических данных: доходность, просадка, соотношение риска к прибыли по реальным сделкам." },
            { icon: "🎯", title: "5 классов активов",              desc: "Акции, крипта, облигации, форекс, товарные активы — ИИ автоматически адаптируется под специфику каждого рынка." },
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
        <p className="section-sub">Начните бесплатно — все основные функции доступны сразу</p>
        <div className="plans-grid">
          <div className="plan-card">
            <div className="plan-name">Трейдер</div>
            <div className="plan-price">Бесплатно</div>
            <div className="plan-desc">Всё необходимое для принятия торговых решений</div>
            <ul className="plan-features">
              <li>Торговые сигналы по любому активу</li>
              <li>График с уровнями входа, стопа и тейка</li>
              <li>Анализ новостей и фундаментала — 10 раз в месяц</li>
              <li>История всех сигналов</li>
              <li>Акции, крипта, форекс, товары, облигации</li>
            </ul>
            <Link href="/register" className="btn-primary" style={{ display: "block", textAlign: "center" }}>
              Зарегистрироваться →
            </Link>
          </div>
          <div className="plan-card featured">
            <div className="plan-name">Профессионал</div>
            <div className="plan-price">Полный доступ</div>
            <div className="plan-desc">Расширенные возможности и управление системой</div>
            <ul className="plan-features">
              <li>Всё из тарифа Трейдер</li>
              <li>Неограниченный анализ новостей и фундаментала</li>
              <li>Исторический бэктест стратегий</li>
              <li>Скриннер инвестиционных идей</li>
              <li>Подписки на сигналы в Telegram и на email</li>
              <li>Управление пользователями</li>
            </ul>
            <Link href="/login" className="btn-outline" style={{ display: "block", textAlign: "center" }}>
              Войти
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
            © 2026 Mantra Trading · Торговый терминал с ИИ<br />
            Не является финансовой рекомендацией. Торговля сопряжена с риском потери капитала.
          </p>
        </div>
      </footer>
    </>
  );
}
