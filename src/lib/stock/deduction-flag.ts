/**
 * Переключатель автоматической постановки удержания.
 *
 * Включается ТОЛЬКО значением `INVENTORY_DEDUCTION_AUTOPOST=1`. Это состояние по умолчанию
 * на проде: пусто, не задано или любое другое значение - выключено, и ни один путь
 * (итоги акта, разнесение списаний, привязка склада, правила) ничего не считает и не пишет.
 *
 * Условие вынесено сюда, чтобы его можно было проверить тестом без Next и базы: "выключено
 * по умолчанию" - самое важное свойство функции, и оно не должно держаться на чтении кода.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

export const AUTOPOST_ENV = "INVENTORY_DEDUCTION_AUTOPOST";

export function isDeductionAutopostEnabled(env: Record<string, string | undefined>): boolean {
  return env[AUTOPOST_ENV] === "1";
}

/** Выполняет `run` только при включённом переключателе; иначе возвращает `null`, `run` не вызывается. */
export async function whenAutopostEnabled<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T | null> {
  if (!isDeductionAutopostEnabled(env)) return null;
  return run();
}
