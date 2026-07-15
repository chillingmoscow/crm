import { isDeploymentSkewError } from "./deployment-skew";

/** Не перезагружаемся чаще этого окна — иначе детерминированная
 *  «skew-подобная» ошибка зациклила бы reload. */
const RELOAD_GUARD_MS = 15_000;
const RELOAD_KEY = "sheerly:deploy-skew-reload";

/**
 * Если ошибка — рассинхрон деплоя (устаревший клиентский бандл ↔ новый
 * сервер) и мы не перезагружались в пределах окна — ставит guard-флаг
 * и перезагружает страницу (клиент подтянет свежий бандл). Возвращает
 * `true`, если reload инициирован. No-op вне браузера и на не-skew
 * ошибках. Guard в sessionStorage защищает от циклов, если ошибка
 * повторилась сразу после reload.
 *
 * Используется и в error-boundary (render-ошибки), и в глобальном
 * listener'е `unhandledrejection`/`error` (async-хендлеры, которые
 * boundary не ловит).
 */
export function maybeReloadForDeploymentSkew(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  if (!isDeploymentSkewError(error)) return false;

  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    // private mode / storage недоступен — не блокируем reload.
  }
  if (Date.now() - last < RELOAD_GUARD_MS) return false;

  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}
