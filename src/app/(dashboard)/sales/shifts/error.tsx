"use client";

import { SalesError } from "../_components/sales-error";

export default function SalesPageError({
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
      page="Смены"
      title="Не удалось открыть смены"
    />
  );
}
