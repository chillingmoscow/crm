"use client";

import { ErrorRecovery } from "@/components/shared/error-recovery";

/**
 * Route error boundary для всего дерева под root-layout'ом. Ловит
 * ошибки рендера/Server Action'ов ниже корня. Главный кейс —
 * рассинхрон деплоя (устаревший бандл ↔ новый сервер): раньше это был
 * неустранимый оверлей «Application error», теперь — авто-reload на
 * свежий бандл (см. ErrorRecovery). Ошибки самого root-layout ловит
 * `global-error.tsx`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} />;
}
