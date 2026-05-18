export type QuickDate = "today" | "tomorrow" | "in7";

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for a quick-pick relative to `anchor` (default: now). */
export function quickDateISO(kind: QuickDate, anchor: Date = new Date()): string {
  const base = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  if (kind === "tomorrow") base.setDate(base.getDate() + 1);
  if (kind === "in7") base.setDate(base.getDate() + 7);
  return toISO(base);
}

/** Разбирает хранимое значение даты на дату и опциональное время.
 *  Формат: `YYYY-MM-DD` либо `YYYY-MM-DDTHH:mm`. */
export function splitDateValue(value: string | null | undefined): {
  date: string;
  time: string | null;
} {
  if (!value) return { date: "", time: null };
  const [date, time] = value.split("T");
  return { date: date ?? "", time: time ? time.slice(0, 5) : null };
}

/** Склеивает дату и опциональное время обратно в хранимое значение. */
export function joinDateValue(date: string, time: string | null): string {
  if (!date) return "";
  return time ? `${date}T${time}` : date;
}

export type DateFormat = "full" | "short" | "relative";

/** Кол-во календарных дней между датой и сегодня (date − today). */
function daysFromToday(dt: Date): number {
  const now = new Date();
  const a = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** «через N ед.» / «N ед. назад» — знак diff задаёт направление. */
function relativeSpan(diff: number, n: number, unit: string): string {
  return diff > 0 ? `через ${n} ${unit}` : `${n} ${unit} назад`;
}

/** Относительная подпись без ограничения неделей: дни → недели →
 *  месяцы → годы. Аббревиатуры (дн./нед./мес./г.) — чтобы не
 *  склонять числительные. */
function relativeLabel(dt: Date): string {
  const diff = daysFromToday(dt);
  const abs = Math.abs(diff);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff === -1) return "Вчера";
  if (abs <= 6) return relativeSpan(diff, abs, "дн.");
  if (abs <= 27) return relativeSpan(diff, Math.round(abs / 7), "нед.");
  if (abs <= 364) return relativeSpan(diff, Math.round(abs / 30), "мес.");
  return relativeSpan(diff, Math.round(abs / 365), "г.");
}

/** Display form for a stored date property value. Empty/invalid → "".
 *  `fmt`: full (default) «15 апреля 2026 г.» · short «15.04.2026» ·
 *  relative «Сегодня»/«через N дн.» (вне ±7 дн. → short).
 *  При наличии времени добавляет «, HH:mm». */
export function formatPropertyDate(
  value: string | null | undefined,
  fmt: DateFormat = "full",
): string {
  const { date, time } = splitDateValue(value);
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return "";

  let base: string;
  if (fmt === "short") {
    base = dt.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } else if (fmt === "relative") {
    base = relativeLabel(dt);
  } else {
    base = dt.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return time ? `${base}, ${time}` : base;
}
