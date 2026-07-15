"use client";

import { useEffect } from "react";

import { maybeReloadForDeploymentSkew } from "@/lib/deployment-skew-reload";

/**
 * Всегда смонтированный глобальный listener для skew-ошибок, которые
 * НЕ проходят через route-error-boundary: Server Action / dynamic
 * import, вызванные из обычного async-хендлера (`void (async () =>
 * ...)()` без transition/catch), дают `unhandledrejection`, а провал
 * загрузки чанка — window `error`. React error-boundary такие не ловит
 * (только render). Здесь классифицируем и делаем тот же авто-reload на
 * свежий бандл (guard от циклов — внутри helper'а).
 *
 * Рендерит null; монтируется один раз в root-layout.
 */
export function DeploymentSkewListener() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      maybeReloadForDeploymentSkew(e.reason);
    };
    const onError = (e: ErrorEvent) => {
      maybeReloadForDeploymentSkew(e.error ?? e.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
