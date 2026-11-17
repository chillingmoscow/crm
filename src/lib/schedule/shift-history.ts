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

const actionTitles: Record<string, string> = {
  "shift.create": "Смена создана",
  "shift.copy": "Создана копией другой смены",
  "shift.publish": "Смена опубликована",
  "shift.delete": "Смена удалена",
};

/**
 * Заголовок записи истории: что именно изменилось («Перенесена на другой
 * день», «Замена сотрудника», «Изменены дата и время»), а не общее
 * «Смена изменена». null — по сути ничего не изменилось, запись не
 * показываем.
 */
export function shiftChangeTitle(
  action: string,
  before: ShiftSnapshot | null | undefined,
  after: ShiftSnapshot | null | undefined,
  ctx: HistoryContext,
): string | null {
  if (actionTitles[action]) return actionTitles[action];
  if (!before || !after) return null;
  const range = (s: ShiftSnapshot) =>
    s.starts_at && s.ends_at ? `${ctx.time(s.starts_at)}–${ctx.time(s.ends_at)}` : "";
  const was = assignee(before);
  const now = assignee(after);
  const changes: { noun: string; single: string }[] = [];
  if (before.starts_at && after.starts_at && ctx.date(before.starts_at) !== ctx.date(after.starts_at))
    changes.push({ noun: "дата", single: "Перенесена на другой день" });
  if (range(before) !== range(after)) changes.push({ noun: "время", single: "Изменено время" });
  if (was !== now)
    changes.push({
      noun: "сотрудник",
      single: !was ? "Назначен сотрудник" : !now ? "Сотрудник снят со смены" : "Замена сотрудника",
    });
  if ((before.role_id ?? null) !== (after.role_id ?? null))
    changes.push({ noun: "должность", single: "Изменена должность" });
  const templateChanged = (before.template_id ?? null) !== (after.template_id ?? null);
  if (templateChanged)
    changes.push({
      noun: "шаблон",
      single: after.template_id ? "Изменён шаблон" : "Стала нестандартной сменой",
    });
  if (!templateChanged && (before.title ?? "") !== (after.title ?? ""))
    changes.push({ noun: "название", single: "Изменено название" });
  if ((before.note ?? "") !== (after.note ?? ""))
    changes.push({
      noun: "заметка",
      single: after.note ? (before.note ? "Изменена заметка" : "Добавлена заметка") : "Удалена заметка",
    });
  if (before.color && after.color && before.color !== after.color)
    changes.push({ noun: "цвет", single: "Изменён цвет" });
  if (!before.published && after.published) changes.push({ noun: "публикация", single: "Опубликована" });
  if (changes.length === 0) return null;
  if (changes.length === 1) return changes[0].single;
  const nouns = changes.map((c) => c.noun);
  return `Изменены ${nouns.slice(0, -1).join(", ")} и ${nouns[nouns.length - 1]}`;
}

export type HistoryEvent = {
  id: string;
  action: string;
  actor_id: string | null;
  created_at: string;
  details: unknown;
};

const MERGE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Склеивает подряд идущие правки одного человека за короткое время в одну
 * запись (итог: «до» самой ранней → «после» самой поздней). Перетаскивание
 * туда-обратно не засоряет историю, а при нулевом итоге запись исчезает
 * (см. shiftChangeTitle). События — от новых к старым.
 */
export function collapseHistory<T extends HistoryEvent>(events: T[]): T[] {
  const editable = (a: string) => a === "shift.edit" || a === "shift.assign";
  const out: T[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    const lastOldest = last as (T & { _oldestAt?: string }) | undefined;
    if (
      last &&
      editable(last.action) &&
      editable(event.action) &&
      last.actor_id === event.actor_id &&
      Date.parse(lastOldest?._oldestAt ?? last.created_at) - Date.parse(event.created_at) <= MERGE_WINDOW_MS
    ) {
      const lastDetails = (last.details ?? {}) as { after?: unknown };
      const eventDetails = (event.details ?? {}) as { before?: unknown };
      out[out.length - 1] = {
        ...last,
        action: last.action === event.action ? last.action : "shift.edit",
        details: { before: eventDetails.before, after: lastDetails.after },
        _oldestAt: event.created_at,
      } as T;
      continue;
    }
    out.push(event);
  }
  return out.map((event) => {
    const { _oldestAt: _ignored, ...rest } = event as T & { _oldestAt?: string };
    void _ignored;
    return rest as unknown as T;
  });
}
