import "./globals.css";
import PWARegister from "./pwa";

export const metadata = {
  title: "Mantra Terminal — нейросетевые сигналы",
  description: "Обучение, walk-forward тестирование и торговые сигналы нейросети на TensorFlow",
  manifest: "/manifest.json",
  themeColor: "#5b8def",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mantra",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Mantra" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#5b8def" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body><PWARegister />{children}</body>
    </html>
  );
}
