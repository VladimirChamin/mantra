import "./globals.css";
import PWARegister from "./pwa";

export const metadata = {
  title: "Mantra Trading — ML торговый терминал",
  description: "Нейросетевые торговые сигналы на основе BiLSTM+CNN+Attention. Акции, крипта, облигации, форекс.",
  manifest: "/manifest.json",
  themeColor: "#3b82f6",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mantra Trading",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
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
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="#3b82f6" />
      </head>
      <body><PWARegister />{children}</body>
    </html>
  );
}
