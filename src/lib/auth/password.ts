/**
 * Правила пароля и оценка его надёжности — одни и те же для проверки формы
 * и для полоски под полем: иначе полоска хвалит пароль («Надёжный»), а
 * отправка отвечает «Минимум 2 цифры».
 */

export type PasswordRule = {
  /** Чего не хватает — строчными, для подсказки «нужно …». */
  need: string;
  test: (password: string) => boolean;
};

export const PASSWORD_MIN_LENGTH: PasswordRule = {
  need: "минимум 8 символов",
  test: (password) => password.length >= 8,
};

export const PASSWORD_TWO_DIGITS: PasswordRule = {
  need: "минимум 2 цифры",
  test: (password) => /(?:\D*\d){2}/.test(password),
};

export const PASSWORD_TWO_LETTERS: PasswordRule = {
  need: "минимум 2 буквы",
  test: (password) => /(?:[^\p{L}]*\p{L}){2}/u.test(password),
};

export type PasswordLevel = 1 | 2 | 3 | 4;

/**
 * Надёжность 1–4 по длине и разнообразию символов. Пока не выполнено
 * хоть одно правило, оценка не выше 1 («Слабый»), и `unmet` — первое
 * невыполненное правило. Пустой пароль — `level: null`.
 */
export function passwordStrength(
  password: string,
  rules: readonly PasswordRule[],
): { level: PasswordLevel | null; unmet: PasswordRule | null } {
  if (!password) return { level: null, unmet: null };
  const unmet = rules.find((rule) => !rule.test(password)) ?? null;
  if (unmet) return { level: 1, unmet };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^\p{L}\d]/u.test(password)) score++;
  const level: PasswordLevel = score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4;
  return { level, unmet: null };
}
