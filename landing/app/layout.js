import "./globals.css";

export const metadata = {
  title: "Mantra Trading — ML торговый терминал",
  description: "Нейросетевые торговые сигналы на основе BiLSTM+CNN+Attention. Акции, крипта, облигации, форекс.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
