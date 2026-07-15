"use client";

import { ErrorRecovery } from "@/components/shared/error-recovery";

import "./globals.css";

/**
 * Global error boundary — ловит ошибки в самом root-layout'е. Заменяет
 * его целиком, поэтому обязан рендерить свои <html>/<body> и не может
 * полагаться на Providers/тему. Работает только в production-сборке.
 * Тот же ErrorRecovery: авто-reload при рассинхроне деплоя, иначе —
 * восстановимый экран.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body className="antialiased font-sans">
        <ErrorRecovery error={error} reset={reset} />
      </body>
    </html>
  );
}
