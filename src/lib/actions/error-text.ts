import { actionErrorMessage } from "./result.ts";

/**
 * Текст ошибки для ответа действия вида `{ error }`. Ошибки Supabase
 * (PostgREST, GoTrue, Storage), исключения и объекты `{ message }` проходят
 * через тот же фильтр, что и `actionResult`: русский текст показывается как
 * есть, английский технический заменяется на `fallback`.
 */
export function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && !(error instanceof Error) && !("issues" in error)) {
    const message = (error as { message?: unknown }).message;
    return actionErrorMessage(typeof message === "string" ? new Error(message) : null, fallback);
  }
  return actionErrorMessage(error, fallback);
}
