/**
 * Утреннее сообщение «Задачи на сегодня» в Telegram: задачи по исполнителям,
 * каждая — ссылкой на свою карточку в расписании. Без server-only: текст
 * проверяется тестами node.
 */

export type DailyTask = {
  /** Задача дня; в сообщениях, поставленных до появления ссылок, его нет. */
  id?: string | null;
  name: string;
  employee: string | null;
  /** Причина, по которой назначение нужно проверить; пусто — всё в порядке. */
  blocked?: string | null;
};

/** Telegram считает лимит 4096 по видимому тексту; оставляем запас. */
const VISIBLE_LIMIT = 3900;
/** Ссылки на задачи — пока список обозрим; дальше только названия. */
const LINKED_TASKS_LIMIT = 50;

const html = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Длина текста, которую увидит человек: без разметки и с раскрытыми сущностями. */
export function visibleLength(text: string): number {
  return text.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot);/g, "x").length;
}

/** «четверг, 27 ноября» по дате YYYY-MM-DD. */
export function businessDayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(day.getTime())) return "сегодня";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(day);
}

export function dailyTasksMessage(
  tasks: readonly DailyTask[],
  date: string,
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const dayUrl = `${base}/schedule?showTasks=1&date=${encodeURIComponent(date)}`;
  const title = `✅ <b>Задачи на ${html(businessDayLabel(date))}</b>`;
  const footer = `<a href="${html(dayUrl)}">Все задачи дня в расписании</a>`;

  const groups = new Map<string, DailyTask[]>();
  for (const task of tasks) {
    const key = task.employee?.trim() || "";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const people = [...groups.keys()]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));

  const render = (linked: boolean) => {
    const line = (task: DailyTask) => {
      const name = html(task.name);
      const label =
        linked && task.id
          ? `<a href="${html(`${dayUrl}&task=${encodeURIComponent(task.id)}`)}">${name}</a>`
          : name;
      return `• ${label}${task.employee && task.blocked ? " — проверьте назначение" : ""}`;
    };
    const list = (group: DailyTask[]) =>
      [...group]
        .sort((a, b) => a.name.localeCompare(b.name, "ru"))
        .map(line)
        .join("\n");
    const blocks = people.map(
      (person) => `👤 <b>${html(person)}</b>\n${list(groups.get(person)!)}`,
    );
    const unassigned = groups.get("");
    if (unassigned?.length)
      blocks.push(`⚠️ <b>Без исполнителя</b> — назначьте в расписании\n${list(unassigned)}`);
    return [
      title,
      ...blocks,
      `Заполните чек-листы и приложите фото к нужным пунктам.\n${footer}`,
    ].join("\n\n");
  };

  const linked = render(tasks.length <= LINKED_TASKS_LIMIT);
  // Ссылки не меняют видимую длину; длинный список целиком — только в приложении.
  if (visibleLength(linked) <= VISIBLE_LIMIT) return linked;
  return `${title}\n\nЗадач: ${tasks.length}. Полный список и чек-листы — в Sheerly.\n${footer}`;
}
