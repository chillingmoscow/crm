/**
 * Результат server action, который доносит текст ошибки до интерфейса.
 *
 * В рабочей сборке Next.js не передаёт клиенту текст исключения, брошенного
 * из server action: вместо него приходит английская заглушка «An error
 * occurred in the Server Components render…». Поэтому действие ловит ошибку
 * само и возвращает её текстом, а клиент превращает его обратно в исключение
 * через `unwrapAction`.
 */
import { quickRestoErrorText } from "../integrations/quickresto/error-text.ts";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CYRILLIC = /[а-яё]/i;

/**
 * Текст ошибки для пользователя. Русский текст (наш или из базы) проходит как
 * есть; английский технический — например, «permission denied» или ошибки
 * проверки zod — заменяется на `fallback`. Ошибки Quick Resto (тайм-аут,
 * сеть, права, ответ сервера) получают свою понятную фразу.
 */
export function actionErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)) {
    const own = error.issues
      .map((issue: { message?: unknown }) => issue?.message)
      .find((message): message is string => typeof message === "string" && CYRILLIC.test(message));
    return own ?? "Проверьте введённые данные";
  }
  const message = error instanceof Error ? error.message.trim() : "";
  const quickResto = quickRestoErrorText(message);
  if (quickResto) return quickResto;
  return message && CYRILLIC.test(message) ? message : fallback;
}

/** Серверная сторона: выполняет действие и возвращает ошибку текстом вместо исключения. */
export async function actionResult<T>(
  run: () => Promise<T>,
  fallback = "Не удалось выполнить действие. Попробуйте ещё раз",
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    console.error(error);
    return { ok: false, error: actionErrorMessage(error, fallback) };
  }
}

/** Клиентская сторона: возвращает данные или бросает ошибку с русским текстом. */
export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
