"use client";

import { SalesError } from "../_components/sales-error";

export default function SalesSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SalesError
      error={error}
      reset={reset}
      page="Настройки продаж"
      title="Не удалось открыть настройки продаж"
    />
  );
}
