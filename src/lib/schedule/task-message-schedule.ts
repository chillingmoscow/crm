/**
 * Расписание сообщений о задачах и графике в Telegram: подписи и тексты.
 * Дни — ISO (1 = понедельник … 7 = воскресенье), как в базе
 * (schedule_task_settings.daily_days / schedule_open_day / schedule_deadline_day).
 */
export const WEEKDAY_SHORT = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"] as const;

const WEEKDAY_NOMINATIVE = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAY_GENITIVE = ["понедельника", "вторника", "среды", "четверга", "пятницы", "субботы", "воскресенья"];
const WEEKDAY_ACCUSATIVE = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

const valid = (day: number) => Number.isInteger(day) && day >= 1 && day <= 7;

export function weekdayName(day: number): string {
  return valid(day) ? WEEKDAY_NOMINATIVE[day - 1] : "";
}

/** «Каждый день», «По будням», «ПН, СР, ПТ». Пустой список — null. */
export function daysLabel(days: readonly number[]): string | null {
  const set = [...new Set(days.filter(valid))].sort((a, b) => a - b);
  if (!set.length) return null;
  if (set.length === 7) return "Каждый день";
  if (set.join() === "1,2,3,4,5") return "По будням";
  if (set.join() === "6,7") return "По выходным";
  return set.map((d) => WEEKDAY_SHORT[d - 1]).join(", ");
}

/** «Каждый день в 12:00», «ПН, СР в 09:30». */
export function dailyScheduleLabel(days: readonly number[], time: string): string | null {
  const label = daysLabel(days);
  return label ? `${label} в ${time.slice(0, 5)}` : null;
}

/** «В понедельник в 14:00 — начать, в среду в 14:00 — последний день». */
export function reminderScheduleLabel(openDay: number, deadlineDay: number, time: string): string | null {
  if (!valid(openDay) || !valid(deadlineDay) || openDay === deadlineDay) return null;
  const t = time.slice(0, 5);
  const open = WEEKDAY_ACCUSATIVE[openDay - 1];
  const deadline = WEEKDAY_ACCUSATIVE[deadlineDay - 1];
  return `${open[0].toUpperCase()}${open.slice(1)} в ${t} — начать сбор, ${deadline} в ${t} — последний день`;
}

/**
 * Текст напоминания (HTML для Telegram, ссылка уже экранирована вызывающим).
 * Старые записи очереди с kind monday/wednesday — это прежние «пн → ср».
 */
export function scheduleReminderText(
  kind: "schedule_open" | "schedule_deadline" | "monday" | "wednesday",
  deadlineDay: number | null | undefined,
  link: string,
): string {
  const deadline = valid(deadlineDay ?? 0) ? deadlineDay! : 3;
  if (kind === "schedule_open" || kind === "monday")
    return `🗓️ <b>Время составлять график!</b>\n\nОбсудите расписание на следующую неделю и через одну с коллегами своего подразделения. Срок сдачи — до ${WEEKDAY_GENITIVE[deadline - 1]} включительно. Затем старшие подразделений составляют график.\n\n${link}`;
  return `⏳ <b>Сегодня последний день сдачи графика!</b>\n\nПередайте расписание на следующую неделю сегодня, согласовав замены и пожелания. Затем старшие подразделений составляют график.\n\n${link}`;
}
