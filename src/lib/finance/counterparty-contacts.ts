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

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return trimmed || null;
};

/** Имя контакта, когда его не вписали (так же переносились старые контакты). */
export const UNNAMED_CONTACT = "Контакт";

/**
 * Список контактов из формы: полностью пустые карточки отбрасываются, без
 * имени — «Контакт», почта и Telegram проверяются. Почту, которая уже лежит в
 * базе (`trustedEmails`), не перепроверяем: старая запись вроде «a@x.ru,
 * b@y.ru» не должна мешать сохранить карточку.
 */
export function normalizeContacts(
  input: unknown,
  opts: { trustedEmails?: Set<string> } = {},
): { contacts: CounterpartyContact[]; error: string | null } {
  if (!Array.isArray(input)) return { contacts: [], error: null };
  const contacts: CounterpartyContact[] = [];
  for (const item of input) {
    const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const name = text(raw.name, 200);
    const role = text(raw.role, 100);
    const phone = text(raw.phone, 30);
    const email = text(raw.email, 200);
    const telegramRaw = typeof raw.telegram === "string" ? raw.telegram : "";
    if (!name && !role && !phone && !email && !telegramRaw.trim()) continue;
    if (email && !EMAIL.test(email) && !opts.trustedEmails?.has(email)) {
      return { contacts: [], error: "Проверьте адрес почты" };
    }
    const telegram = normalizeTelegram(telegramRaw);
    if (telegram.error) return { contacts: [], error: telegram.error };
    contacts.push({ name: name ?? UNNAMED_CONTACT, role, phone, email, telegram: telegram.value });
  }
  if (contacts.length > MAX_CONTACTS) return { contacts: [], error: "Не больше 10 контактов" };
  return { contacts, error: null };
}

/** Контакты из базы (jsonb) — без доверия к форме: чужие ключи отбрасываются. */
export function contactsFromJson(value: unknown): CounterpartyContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      role: typeof item.role === "string" ? item.role : null,
      phone: typeof item.phone === "string" ? item.phone : null,
      email: typeof item.email === "string" ? item.email : null,
      telegram: typeof item.telegram === "string" ? item.telegram : null,
    }))
    .filter((contact) => contact.name);
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
