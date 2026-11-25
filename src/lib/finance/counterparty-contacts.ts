/**
 * Контакты и условия поставок контрагента: проверка и приведение к виду,
 * в котором они лежат в базе. Общие для сервера и браузера.
 */

export type CounterpartyContact = {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  /** Ник без «@». */
  telegram: string | null;
};

export const MAX_CONTACTS = 10;
const TELEGRAM_ERROR = "Telegram: ник из 5–32 латинских букв, цифр и _";
const NICK = /^[A-Za-z0-9_]{5,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «@ник», «t.me/ник», «https://t.me/ник» → «ник». Пусто — null. */
export function normalizeTelegram(input: string): { value: string | null; error: string | null } {
  const raw = input.trim();
  if (!raw) return { value: null, error: null };
  const nick = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?(t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  return NICK.test(nick) ? { value: nick, error: null } : { value: null, error: TELEGRAM_ERROR };
}

export function telegramUrl(nick: string): string {
  return `https://t.me/${nick}`;
}

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
};

/**
 * Список контактов из формы: полностью пустые карточки отбрасываются,
 * у остальных обязательно имя, почта и Telegram проверяются.
 */
export function normalizeContacts(input: unknown): { contacts: CounterpartyContact[]; error: string | null } {
  if (!Array.isArray(input)) return { contacts: [], error: null };
  const contacts: CounterpartyContact[] = [];
  for (const item of input) {
    const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = text(raw.name);
    const role = text(raw.role);
    const phone = text(raw.phone);
    const email = text(raw.email);
    const telegramRaw = typeof raw.telegram === "string" ? raw.telegram : "";
    if (!name && !role && !phone && !email && !telegramRaw.trim()) continue;
    if (!name) return { contacts: [], error: "Укажите имя контакта" };
    if (email && !EMAIL.test(email)) return { contacts: [], error: "Проверьте адрес почты" };
    const telegram = normalizeTelegram(telegramRaw);
    if (telegram.error) return { contacts: [], error: telegram.error };
    contacts.push({ name, role, phone, email, telegram: telegram.value });
  }
  if (contacts.length > MAX_CONTACTS) return { contacts: [], error: "Не больше 10 контактов" };
  return { contacts, error: null };
}

/** Дни недели: 1 — понедельник … 7 — воскресенье. */
export const WEEKDAYS: { value: number; short: string }[] = [
  { value: 1, short: "пн" },
  { value: 2, short: "вт" },
  { value: 3, short: "ср" },
  { value: 4, short: "чт" },
  { value: 5, short: "пт" },
  { value: 6, short: "сб" },
  { value: 7, short: "вс" },
];

export function normalizeWeekdays(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const days = input.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7);
  return [...new Set(days)].sort((a, b) => a - b);
}
