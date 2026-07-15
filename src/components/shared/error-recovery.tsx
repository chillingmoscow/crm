"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { isDeploymentSkewError } from "@/lib/deployment-skew";
import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/**
 * Общий UI для error-boundary'ев (`app/error.tsx`, `app/global-error.tsx`).
 *
 * При ошибке рассинхрона деплоя (устаревший клиентский бандл ↔ новый
 * сервер) — авто-reload (клиент подтянет свежий бандл), с guard'ом от
 * циклов. Для прочих ошибок — аккуратный восстановимый экран вместо
 * дефолтного неустранимого «Application error» Next.js.
 */
export function ErrorRecovery({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const skew = isDeploymentSkewError(error);
  const [reloading, setReloading] = useState(skew);
  const handled = useRef(false);

  useEffect(() => {
    if (!skew || handled.current) return;
    handled.current = true;
    // Guard от циклов внутри helper'а: если reload не инициирован
    // (недавно уже перезагружались) — показываем ручное восстановление.
    if (!maybeReloadForDeploymentSkew(error)) setReloading(false);
  }, [skew, error]);

  if (reloading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Обновляем приложение…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[17px] font-semibold tracking-tight text-foreground">
            Что-то пошло не так
          </h1>
          <p className="text-sm leading-snug text-muted-foreground">
            Произошла ошибка при загрузке страницы. Обычно помогает
            обновление — приложение подтянет свежую версию.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="size-4" />
            Обновить страницу
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-input px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    </div>
  );
}
