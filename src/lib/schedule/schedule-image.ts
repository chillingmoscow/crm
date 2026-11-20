import { addDays, dateInZone, dayLabel, timeInZone } from "./utils.ts";

/**
 * Картинка расписания для команды: кто когда выходит на неделе.
 *
 * Здесь только чистая логика: отбор смен, сбор строк по подразделениям и
 * разбиение на несколько картинок. Рисует картинку `schedule-image-render.tsx`,
 * данные собирает `schedule-image-data.ts`.
 *
 * В картинку попадают только опубликованные смены с сотрудником. Черновики,
 * смены «Без сотрудника», кандидаты, задачи, ставки и часы сюда не входят:
 * картинку отправляют в общий чат.
 */

export type ImageShift = {
  id: string;
  published: boolean;
  starts_at: string;
  ends_at: string;
  user_id: string | null;
  payroll_employee_id?: string | null;
  department_id: string | null;
  role_id: string | null;
  template_id: string | null;
  color: string;
};
export type ImagePerson = {
  /** user_id сотрудника или `payroll:<id>` для разового. */
  key: string;
  name: string;
  role: string;
};
export type ScheduleImageInput = {
  venueName: string;
  timezone: string;
  /** Понедельник недели, YYYY-MM-DD. */
  week: string;
  /** Только это подразделение (фильтр на экране); null — все. */
  department: string | null;
  shifts: ImageShift[];
  people: ImagePerson[];
  departments: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  /** Текущие цвета шаблонов: цвет смены равен цвету её шаблона. */
  templateColors: Record<string, string>;
};
export type ImageSlot = { start: string; end: string; color: string };
export type ImageRow = {
  key: string;
  name: string;
  role: string;
  /** Семь дней недели, в каждом — смены по времени начала. */
  days: ImageSlot[][];
};
export type ImageGroup = { id: string; name: string; rows: ImageRow[] };
export type ScheduleImagePart = {
  /** Подпись части: подразделения на картинке и «1 из 2», если подразделение разрезано. */
  label: string;
  groups: ImageGroup[];
};
export type ScheduleImage = {
  venueName: string;
  period: string;
  days: { date: string; weekday: string; day: string }[];
  parts: ScheduleImagePart[];
};

export const NO_DEPARTMENT = "none";
const NO_DEPARTMENT_NAME = "Без подразделения";
/**
 * Сколько строк помещается на одну картинку. Telegram на телефоне показывает
 * фото во всю ширину, а длинную картинку ужимает: больше ~14 строк уже не
 * прочитать без увеличения. Заголовок подразделения считается за полстроки.
 */
export const ROWS_PER_IMAGE = 14;
const GROUP_HEADER_WEIGHT = 0.5;

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const personKey = (s: ImageShift) =>
  s.payroll_employee_id ? `payroll:${s.payroll_employee_id}` : s.user_id;

/** «23–29 ноября 2026», «30 ноября – 6 декабря 2026», «29 декабря 2025 – 4 января 2026». */
export function weekPeriodLabel(week: string) {
  const end = addDays(week, 6);
  const [y1, m1] = week.split("-");
  const [y2, m2] = end.split("-");
  const day = (d: string) => String(Number(d.slice(8)));
  const month = (d: string) => dayLabel(d, { day: "numeric", month: "long" }).replace(/^\d+\s*/, "");
  if (y1 !== y2) return `${day(week)} ${month(week)} ${y1} – ${day(end)} ${month(end)} ${y2}`;
  if (m1 !== m2) return `${day(week)} ${month(week)} – ${day(end)} ${month(end)} ${y2}`;
  return `${day(week)}–${day(end)} ${month(end)} ${y2}`;
}

/** Смены, которые можно показать команде: опубликованные, с сотрудником, на этой неделе. */
export function teamVisibleShifts(input: Pick<ScheduleImageInput, "shifts" | "timezone" | "week" | "department">) {
  const days = new Set(Array.from({ length: 7 }, (_, i) => addDays(input.week, i)));
  return input.shifts.filter(
    (s) =>
      s.published &&
      !!personKey(s) &&
      days.has(dateInZone(s.starts_at, input.timezone)) &&
      (!input.department ||
        (input.department === NO_DEPARTMENT ? !s.department_id : s.department_id === input.department)),
  );
}

/** Подразделения со строками сотрудников; порядок — по названию, «Без подразделения» в конце. */
export function buildImageGroups(input: ScheduleImageInput): ImageGroup[] {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(input.week, i));
  const people = new Map(input.people.map((p) => [p.key, p]));
  const departments = new Map(input.departments.map((d) => [d.id, d.name]));
  const roles = new Map(input.roles.map((r) => [r.id, r.name]));
  const groups = new Map<string, Map<string, { shifts: ImageShift[] }>>();
  for (const shift of teamVisibleShifts(input)) {
    const group = shift.department_id && departments.has(shift.department_id) ? shift.department_id : NO_DEPARTMENT;
    const rows = groups.get(group) ?? new Map();
    groups.set(group, rows);
    const key = personKey(shift)!;
    const row = rows.get(key) ?? { shifts: [] };
    rows.set(key, row);
    row.shifts.push(shift);
  }
  const result: ImageGroup[] = [...groups].map(([id, rows]) => ({
    id,
    name: id === NO_DEPARTMENT ? NO_DEPARTMENT_NAME : departments.get(id)!,
    rows: [...rows].map(([key, { shifts }]) => {
      const person = people.get(key);
      // Должность в строке — та, на которую человек выходит в этом подразделении.
      const shiftRoles = [...new Set(shifts.map((s) => (s.role_id ? roles.get(s.role_id) : null)).filter(Boolean))] as string[];
      return {
        key,
        name: person?.name || "Сотрудник",
        role: shiftRoles.length ? shiftRoles.sort(collator.compare).join(", ") : person?.role ?? "",
        days: dates.map((date) =>
          shifts
            .filter((s) => dateInZone(s.starts_at, input.timezone) === date)
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
            .map((s) => ({
              start: timeInZone(s.starts_at, input.timezone),
              end: timeInZone(s.ends_at, input.timezone),
              color: (s.template_id && input.templateColors[s.template_id]) || s.color,
            })),
        ),
      };
    }).sort((a, b) => collator.compare(a.role, b.role) || collator.compare(a.name, b.name)),
  }));
  return result.sort((a, b) =>
    a.id === NO_DEPARTMENT ? 1 : b.id === NO_DEPARTMENT ? -1 : collator.compare(a.name, b.name),
  );
}

const weight = (groups: ImageGroup[]) =>
  groups.reduce((sum, g) => sum + g.rows.length + GROUP_HEADER_WEIGHT, 0);

/**
 * Делит подразделения на картинки. Подразделение не разрывается, пока оно
 * помещается на одну картинку; соседние маленькие подразделения собираются
 * вместе. Подразделение больше одной картинки режется на равные части
 * «Кухня · 1 из 2». Пустая неделя — одна пустая картинка.
 */
export function splitImageParts(groups: ImageGroup[], capacity = ROWS_PER_IMAGE): ScheduleImagePart[] {
  const parts: ImageGroup[][] = [];
  let current: ImageGroup[] = [];
  const flush = () => {
    if (current.length) parts.push(current);
    current = [];
  };
  const labels = new Map<ImageGroup, string>();
  for (const group of groups) {
    // Одно подразделение на картинке: заголовок не отнимает места у строк.
    if (group.rows.length > capacity) {
      flush();
      const pieces = Math.ceil(group.rows.length / Math.floor(capacity));
      const size = Math.ceil(group.rows.length / pieces);
      for (let i = 0; i < pieces; i++) {
        const piece = { ...group, rows: group.rows.slice(i * size, (i + 1) * size) };
        labels.set(piece, `${group.name} · ${i + 1} из ${pieces}`);
        parts.push([piece]);
      }
      continue;
    }
    if (weight([...current, group]) > capacity) flush();
    current.push(group);
  }
  flush();
  if (!parts.length) return [{ label: "", groups: [] }];
  return parts.map((groupsOfPart) => ({
    label: groupsOfPart.map((g) => labels.get(g) ?? g.name).join(", "),
    groups: groupsOfPart,
  }));
}

export function buildScheduleImage(input: ScheduleImageInput, capacity = ROWS_PER_IMAGE): ScheduleImage {
  return {
    venueName: input.venueName,
    period: weekPeriodLabel(input.week),
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(input.week, i);
      const weekday = dayLabel(date, { weekday: "short" });
      return { date, weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), day: String(Number(date.slice(8))) };
    }),
    parts: splitImageParts(buildImageGroups(input), capacity),
  };
}

/** Имя файла картинки: «Расписание 23–29 ноября 2026 · Кухня.png». */
export function scheduleImageFileName(image: Pick<ScheduleImage, "period" | "parts">, part: number) {
  const label = image.parts.length > 1 ? image.parts[part]?.label : "";
  return `Расписание ${image.period}${label ? ` · ${label}` : ""}.png`.replace(/[\\/:*?"<>|]/g, " ");
}

/** Подпись к фото в Telegram (HTML). */
export function scheduleImageCaption(image: Pick<ScheduleImage, "venueName" | "period">) {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<b>Расписание на ${escape(image.period)}</b>\n${escape(image.venueName)}`;
}
