/**
 * Классификатор ошибок «рассинхрона деплоя» (deployment skew): в
 * браузере открыт СТАРЫЙ клиентский бандл, а сервер уже обновился
 * (Coolify редеплоит на каждый мерж в main). Тогда:
 *
 *  - вызов Server Action падает: его content-hash ID пропал в новой
 *    сборке → «Failed to find Server Action … from an older or newer
 *    deployment» (видно в серверных логах);
 *  - динамический JS/CSS-чанк не грузится: имена чанков хешируются
 *    per-build, старые файлы удалены → ChunkLoadError / «Loading
 *    chunk N failed».
 *
 * Обе лечатся ПЕРЕЗАГРУЗКОЙ — клиент получает свежий бандл. Пользователю
 * это видно как «Application error: a client-side exception» (пока нет
 * error-boundary — дефолтный неустранимый оверлей Next.js).
 *
 * Pure-функция, покрыта unit-тестом; используется в error-boundary'ях
 * (`app/error.tsx`, `app/global-error.tsx`) для авто-reload.
 */
const SKEW_SIGNATURES = [
  // Server Action version mismatch: серверный лог и клиентская ошибка
  // Next 15.5 (UnrecognizedActionError: «Server Action "…" was not
  // found on the server … failed-to-find-server-action»).
  "failed to find server action",
  "failed-to-find-server-action",
  "unrecognizedactionerror",
  "an older or newer deployment",
  // Chunk / dynamic import skew
  "chunkloaderror",
  "loading chunk",
  "loading css chunk",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to fetch dynamically imported module",
];

export function isDeploymentSkewError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
    if (typeof error.stack === "string") parts.push(error.stack);
  } else if (typeof error === "string") {
    parts.push(error);
  } else if (error && typeof error === "object") {
    const anyErr = error as { name?: unknown; message?: unknown };
    if (typeof anyErr.name === "string") parts.push(anyErr.name);
    if (typeof anyErr.message === "string") parts.push(anyErr.message);
  }
  const hay = parts.join(" ").toLowerCase();
  return SKEW_SIGNATURES.some((sig) => hay.includes(sig));
}

/**
 * Ответ сервера на вызов Server Action, которого нет в текущей сборке:
 * Next ставит этот заголовок, а клиент бросает UnrecognizedActionError.
 * Проверяем по ответу, а не по ошибке — компоненты часто ловят ошибку
 * сами (try/catch → «Не удалось загрузить…»), и до глобального
 * listener'а она не доходит.
 */
export const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";

export function isDeploymentSkewResponse(response: { headers: { get(name: string): string | null } }): boolean {
  return response.headers.get(ACTION_NOT_FOUND_HEADER) === "1";
}
