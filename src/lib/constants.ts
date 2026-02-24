export const VENUE_TYPES = [
  { value: "restaurant", label: "Ресторан" },
  { value: "bar",        label: "Бар" },
  { value: "cafe",       label: "Кафе" },
  { value: "club",       label: "Клуб" },
  { value: "other",      label: "Другое" },
] as const;

export const CURRENCIES = [
  { value: "RUB", label: "₽ Российский рубль" },
  { value: "USD", label: "$ Доллар США" },
  { value: "EUR", label: "€ Евро" },
  { value: "KZT", label: "₸ Казахстанский тенге" },
  { value: "BYN", label: "Br Белорусский рубль" },
  { value: "UZS", label: "Uzbek Sum" },
  { value: "UAH", label: "₴ Украинская гривна" },
  { value: "GBP", label: "£ Британский фунт" },
  { value: "AED", label: "AED Дирхам ОАЭ" },
] as const;

export const TIMEZONES = [
  { value: "Europe/Kaliningrad",  label: "UTC+2 — Калининград" },
  { value: "Europe/Moscow",       label: "UTC+3 — Москва, Санкт-Петербург" },
  { value: "Europe/Samara",       label: "UTC+4 — Самара, Ижевск" },
  { value: "Asia/Yekaterinburg",  label: "UTC+5 — Екатеринбург" },
  { value: "Asia/Omsk",           label: "UTC+6 — Омск" },
  { value: "Asia/Krasnoyarsk",    label: "UTC+7 — Красноярск, Новосибирск" },
  { value: "Asia/Irkutsk",        label: "UTC+8 — Иркутск" },
  { value: "Asia/Yakutsk",        label: "UTC+9 — Якутск" },
  { value: "Asia/Vladivostok",    label: "UTC+10 — Владивосток" },
  { value: "Asia/Magadan",        label: "UTC+11 — Магадан" },
  { value: "Asia/Kamchatka",      label: "UTC+12 — Камчатка" },
  { value: "Europe/Kiev",         label: "UTC+2/3 — Киев" },
  { value: "Europe/Minsk",        label: "UTC+3 — Минск" },
  { value: "Asia/Almaty",         label: "UTC+5 — Алматы, Астана" },
  { value: "Asia/Tashkent",       label: "UTC+5 — Ташкент" },
  { value: "UTC",                 label: "UTC±0" },
] as const;

export const DAYS_OF_WEEK = [
  { key: "mon", label: "Пн" },
  { key: "tue", label: "Вт" },
  { key: "wed", label: "Ср" },
  { key: "thu", label: "Чт" },
  { key: "fri", label: "Пт" },
  { key: "sat", label: "Сб" },
  { key: "sun", label: "Вс" },
] as const;

export type DayKey = (typeof DAYS_OF_WEEK)[number]["key"];
