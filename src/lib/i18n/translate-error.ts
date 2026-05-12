/**
 * translate-error — единая точка перевода известных английских error-message'ей
 * (Supabase Auth + наши SQL RPC raise exception) в русский.
 *
 * Зачем: Supabase Auth и Postgres-функции из миграций часто возвращают
 * `error.message` на английском. Без перевода юзер видит «Error sending
 * email change email», «Insufficient permissions», «Owner role cannot be
 * modified» и т.п. — выглядит как сырой технический сбой.
 *
 * Использовать в каждом server-action / on-the-boundary месте, которое
 * пишет `toast.error(...)`:
 *
 *   const { error } = await supabase.auth.updateUser({ email });
 *   if (error) {
 *     toast.error(translateError(error.message));
 *     return;
 *   }
 *
 * Если строка не в словаре — возвращаем как есть (graceful fallback).
 *
 * Словарь — open-ended; добавляй новые маппинги по мере того, как
 * замечаешь английские тосты в UI.
 */

const DICTIONARY: Record<string, string> = {
  // ── Supabase Auth ───────────────────────────────────────────────────────
  "Error sending email change email":
    "Не удалось отправить письмо для смены email. Проверьте настройки SMTP.",
  "Error sending recovery email":
    "Не удалось отправить письмо для восстановления пароля. Проверьте настройки SMTP.",
  "Error sending confirmation email":
    "Не удалось отправить письмо подтверждения. Проверьте настройки SMTP.",
  "Error sending magic link":
    "Не удалось отправить magic-link. Проверьте настройки SMTP.",
  "Invalid login credentials":
    "Неверный email или пароль.",
  "Email not confirmed":
    "Email ещё не подтверждён. Проверьте почту.",
  "User already registered":
    "Этот email уже зарегистрирован.",
  "User not found":
    "Пользователь не найден.",
  "Email rate limit exceeded":
    "Слишком много писем. Подождите минуту и попробуйте снова.",
  "New password should be different from the old password":
    "Новый пароль должен отличаться от старого.",
  "Password should be at least 6 characters":
    "Пароль должен быть не короче 6 символов.",
  "Unable to validate email address: invalid format":
    "Некорректный формат email.",
  "Token has expired or is invalid":
    "Ссылка устарела или недействительна. Запросите новую.",

  // ── Наши SQL RPC (raise exception ...) ─────────────────────────────────
  "Not authenticated":
    "Сессия истекла. Войдите заново.",
  "Insufficient permissions":
    "Недостаточно прав для этого действия.",
  "Active account is not set":
    "Активный аккаунт не выбран.",
  "Role not found":
    "Роль не найдена.",
  "Source role not found":
    "Исходная роль не найдена.",
  "Target role not found":
    "Целевая роль не найдена.",
  "Source role is outside active account":
    "Исходная роль не относится к текущему аккаунту.",
  "Target role is outside active account":
    "Целевая роль не относится к текущему аккаунту.",
  "Role is outside active account":
    "Роль не относится к текущему аккаунту.",
  "Target must be a custom (account-scoped) role":
    "Целевая роль должна быть кастомной, а не системной.",
  "Owner role cannot be modified":
    "Роль «Владелец» нельзя редактировать.",
  "Owner role cannot be hidden":
    "Роль «Владелец» нельзя скрыть.",
  "Permission not found":
    "Право доступа не найдено.",
};

/**
 * Возвращает русский перевод известной ошибки. Для неизвестных —
 * исходную строку без изменений.
 */
export function translateError(message: string | null | undefined): string {
  if (!message) return "";
  const trimmed = message.trim();
  // Иногда Postgres оборачивает наше raise exception в формат
  // «ERROR: <msg> (SQLSTATE ...)». Срезаем префикс/суффикс.
  const stripped = trimmed
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s*\(SQLSTATE [^)]+\)\s*$/i, "")
    .trim();
  return DICTIONARY[stripped] ?? DICTIONARY[trimmed] ?? trimmed;
}
