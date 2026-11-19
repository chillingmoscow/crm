"use client";

import { useEffect } from "react";

import { isDeploymentSkewResponse } from "@/lib/deployment-skew";
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
 * Ошибки, которые компонент поймал сам (try/catch → «Не удалось
 * загрузить задачи»), сюда не доходят. Поэтому вызовы Server Action
 * проверяем ещё и по ответу: обёртка над fetch смотрит заголовок
 * «action not found» и перезагружает страницу независимо от того,
 * как компонент обработал ошибку.
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
    const nativeFetch = window.fetch;
    const watchedFetch: typeof window.fetch = async (...args) => {
      const response = await nativeFetch.apply(window, args);
      if (isDeploymentSkewResponse(response))
        maybeReloadForDeploymentSkew("UnrecognizedActionError");
      return response;
    };
    window.fetch = watchedFetch;
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      if (window.fetch === watchedFetch) window.fetch = nativeFetch;
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
