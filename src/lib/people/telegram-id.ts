// Telegram ID в формах добавления сотрудника. Без числового ID бот не может
// исключить человека из чатов при увольнении, поэтому при включённом
// «Пригласить в чаты» поле обязательно.

export const TELEGRAM_ID_HINT = "Числовой ID: человек узнаёт его, написав боту @userinfobot";
export const TELEGRAM_ID_REQUIRED =
  "Укажите Telegram ID — без него бот не сможет исключить сотрудника из чатов при увольнении";

/** Пусто → null, иначе значение без пробелов по краям (формат проверяет `telegramIdError`). */
export function normalizeTelegramId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

/** Текст ошибки или null. `required` — включены приглашения в чаты. */
export function telegramIdError(value: string | null | undefined, required: boolean): string | null {
  const v = normalizeTelegramId(value);
  if (v === null) return required ? TELEGRAM_ID_REQUIRED : null;
  return /^\d{1,15}$/.test(v) ? null : "Telegram ID — только цифры, до 15 знаков";
}
