/**
 * Текст ошибки фонового обновления для интерфейса. Обработчики Quick Resto
 * сохраняют сообщение как есть — бывает английский текст сервера, ответ
 * провайдера или технический код. Пользователь видит только русские
 * сообщения; всё остальное заменяется общей формулировкой.
 */
export function salesErrorText(
  raw: string | null | undefined,
  fallback = "Не удалось получить данные из Quick Resto. Повторите обновление позже",
): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  // Русская фраза с названием системы («Quick Resto не ответил») — допустима.
  if (cyrillic >= 3 && cyrillic >= latin) return text.slice(0, 300);
  return fallback;
}
