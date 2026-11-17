/**
 * Человекочитаемое описание записи истории смены: что именно изменилось.
 * Запись хранит снимки смены до и после действия (`details.before/after`).
 */
export type ShiftSnapshot = {
  starts_at?: string;
  ends_at?: string;
  user_id?: string | null;
  payroll_employee_id?: string | null;
  role_id?: string | null;
  template_id?: string | null;
  title?: string;
  color?: string;
  note?: string;
  published?: boolean;
};

export type HistoryContext = {
  /** «17 нояб.» для момента времени в часовом поясе заведения. */
  date: (iso: string) => string;
  /** «09:00» для момента времени в часовом поясе заведения. */
  time: (iso: string) => string;
  /** Имя исполнителя по ключу user_id или `payroll:<id>`; null — без сотрудника. */
  person: (key: string | null) => string;
  role: (id: string | null) => string;
  template: (id: string | null) => string;
};

const assignee = (s: ShiftSnapshot) =>
  s.payroll_employee_id ? `payroll:${s.payroll_employee_id}` : (s.user_id ?? null);

export function describeShiftChange(
  action: string,
  before: ShiftSnapshot | null | undefined,
  after: ShiftSnapshot | null | undefined,
  ctx: HistoryContext,
): string[] {
  const range = (s: ShiftSnapshot) =>
    s.starts_at && s.ends_at ? `${ctx.time(s.starts_at)}–${ctx.time(s.ends_at)}` : "";
  if (!after) return [];
  if (action === "shift.create" || action === "shift.copy" || !before) {
    return [
      [after.starts_at ? ctx.date(after.starts_at) : "", range(after)].filter(Boolean).join(", "),
      ctx.person(assignee(after)),
    ].filter(Boolean);
  }
  const lines: string[] = [];
  if (before.starts_at && after.starts_at && ctx.date(before.starts_at) !== ctx.date(after.starts_at))
    lines.push(`Дата: ${ctx.date(before.starts_at)} → ${ctx.date(after.starts_at)}`);
  if (range(before) !== range(after)) lines.push(`Время: ${range(before)} → ${range(after)}`);
  if (assignee(before) !== assignee(after))
    lines.push(`Сотрудник: ${ctx.person(assignee(before))} → ${ctx.person(assignee(after))}`);
  if ((before.role_id ?? null) !== (after.role_id ?? null))
    lines.push(`Должность: ${ctx.role(before.role_id ?? null)} → ${ctx.role(after.role_id ?? null)}`);
  if ((before.template_id ?? null) !== (after.template_id ?? null))
    lines.push(
      after.template_id
        ? `Шаблон: ${ctx.template(after.template_id)}`
        : "Стала своей сменой, без шаблона",
    );
  if ((before.title ?? "") !== (after.title ?? "") && lines.every((l) => !l.startsWith("Шаблон")))
    lines.push(`Название: ${before.title} → ${after.title}`);
  if ((before.note ?? "") !== (after.note ?? ""))
    lines.push(after.note ? (before.note ? "Изменена заметка" : "Добавлена заметка") : "Удалена заметка");
  if (before.color && after.color && before.color !== after.color) lines.push("Изменён цвет");
  if (!before.published && after.published && action !== "shift.publish") lines.push("Опубликована");
  return lines;
}
