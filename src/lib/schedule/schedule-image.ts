import { addDays, dateInZone, dayLabel, timeInZone } from "./utils.ts";
import { DEFAULT_TEMPLATE_SORT, sortTemplates, type TemplateSort } from "./template-order.ts";
import type { TemplateVariant } from "./template-times.ts";

/**
 * Картинка расписания для команды: кто когда выходит на неделе.
 *
 * Раскладка — как вид «По шаблонам»: строки — шаблоны смен, столбцы — дни
 * недели, в ячейке — сотрудники с временем. Смены без шаблона (или по
 * шаблону в архиве) — в последней строке «Другие смены».
 *
 * Здесь только чистая логика: отбор смен, строки, раскладка по высоте и
 * разбиение на несколько картинок. Рисует `schedule-image-render.tsx`,
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
  template_id: string | null;
  title: string;
  color: string;
};
export type ImageTemplate = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  department_id: string | null;
  archived: boolean;
  /** Время шаблона — для порядка строк «по времени», как в виде «По шаблонам». */
  start_time: string;
  end_time: string;
  variants: TemplateVariant[] | null;
};
export type ImagePerson = {
  /** user_id сотрудника или `payroll:<id>` для разового. */
  key: string;
  name: string;
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
  templates: ImageTemplate[];
  /** Порядок строк — как выбран на экране; по умолчанию по времени начала. */
  sort?: TemplateSort;
};
/** Сотрудник в ячейке. Строки текста уже разложены: высота картинки считается заранее. */
export type ImageSlot = {
  color: string;
  /** Название смены — только в строке «Другие смены». */
  title: string | null;
  name: string[];
  time: string[];
};
export type ImageRow = {
  key: string;
  /** Название шаблона по строкам (не больше двух). */
  title: string[];
  /** Подзаголовок шаблона по строкам (0–2). */
  subtitle: string[];
  /** Цвет точки шаблона; null у «Другие смены». */
  color: string | null;
  days: ImageSlot[][];
};
export type ScheduleImagePart = { rows: ImageRow[] };
export type ScheduleImage = {
  venueName: string;
  period: string;
  days: { date: string; weekday: string; day: string }[];
  parts: ScheduleImagePart[];
};

/**
 * Размеры картинки — шкала дизайн-системы ×2 (макет 1024px, картинка 2048px):
 * кегли 26/24 — это 13/12. Ширина выбрана под столбец дня: в нём должны
 * помещаться имя и фамилия (~15 букв в строке). Telegram показывает фото во
 * всю ширину телефона, по нажатию — во весь экран с увеличением.
 */
export const LAYOUT = {
  width: 2048,
  pad: 32,
  labelCol: 260,
  header: 150,
  headRow: 64,
  empty: 200,
  footer: 40,
  cellPad: 6,
  slotGap: 8,
  slotPadY: 8,
  slotPadX: 8,
  line: 30,
  titleLine: 34,
  font: 24,
  titleFont: 26,
  rowPadY: 16,
  dot: 20,
  /** Тело одной картинки не выше этого: дальше Telegram ужимает фото так, что не прочитать. */
  maxBody: 1700,
} as const;
export const DAY_COL = (LAYOUT.width - LAYOUT.pad * 2 - LAYOUT.labelCol) / 7;
const SLOT_TEXT = DAY_COL - LAYOUT.cellPad * 2 - LAYOUT.slotPadX * 2;
/** Ширина текста в столбце шаблонов: отступы 24/16, точка цвета и зазор 12. */
export const LABEL_TEXT = LAYOUT.labelCol - 24 - 16 - LAYOUT.dot - 12;
/** Строка «Другие смены» без точки цвета. */
export const OTHER_TEXT = LAYOUT.labelCol - 24 - 16;

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const personKey = (s: ImageShift) =>
  s.payroll_employee_id ? `payroll:${s.payroll_employee_id}` : s.user_id;

/**
 * Примерная ширина строки Inter в пикселях. Нужна, чтобы заранее решить,
 * в одну или две строки встанет текст, — иначе не посчитать высоту картинки.
 * С запасом: длиннее оценки текст не бывает, в худшем случае поставится «…».
 */
export function textWidth(text: string, size: number) {
  let em = 0;
  for (const ch of text) {
    if (/\d/.test(ch)) em += 0.62;
    else if (/[:.,'’ ]/.test(ch)) em += 0.3;
    else if (/[–-]/.test(ch)) em += 0.6;
    else if (/[шщжыюмфШЩЖЫЮМФWMwm]/.test(ch)) em += 0.86;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) em += 0.72;
    else em += 0.6;
  }
  return em * size;
}

/** «10–22», «10:30–22»; не влезает в столбец — в две строки: «10:30–» и «22:30». */
export function slotTime(start: string, end: string, width = SLOT_TEXT): string[] {
  const short = (t: string) => (t.endsWith(":00") ? String(Number(t.slice(0, 2))) : t);
  const one = `${short(start)}–${short(end)}`;
  return textWidth(one, LAYOUT.font) <= width ? [one] : [`${short(start)}–`, short(end)];
}

/** Имя и фамилия в одну строку; не влезают — имя в первой строке, остальное во второй. */
export function slotName(name: string, width = SLOT_TEXT): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["Сотрудник"];
  const full = words.join(" ");
  if (words.length === 1 || textWidth(full, LAYOUT.font) <= width) return [full];
  return [words[0], words.slice(1).join(" ")];
}

/** Название шаблона в одну-две строки по словам; что не влезло — в конец второй строки (там «…»). */
export function labelLines(text: string, width = LABEL_TEXT, size: number = LAYOUT.titleFont): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (lines.length === 2 || textWidth(`${last} ${word}`, size) <= width))
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/**
 * Не больше стольких сотрудников в ячейке; остальные — карточкой «+N ещё».
 * Так высота строки ограничена: иначе мероприятие на 40 человек дало бы
 * картинку, которую Telegram не примет.
 */
export const MAX_SLOTS_PER_CELL = 6;
export function capCell(slots: ImageSlot[]): ImageSlot[] {
  if (slots.length <= MAX_SLOTS_PER_CELL) return slots;
  const shown = slots.slice(0, MAX_SLOTS_PER_CELL - 1);
  const rest = slots.length - shown.length;
  return [...shown, { color: shown[0].color, title: null, name: [`+${rest} ещё`], time: [] }];
}

export const slotHeight = (slot: ImageSlot) =>
  LAYOUT.slotPadY * 2 + (slot.name.length + slot.time.length + (slot.title ? 1 : 0)) * LAYOUT.line;

export function rowHeight(row: ImageRow) {
  const label = LAYOUT.rowPadY * 2 + row.title.length * LAYOUT.titleLine + row.subtitle.length * LAYOUT.line;
  const cells = row.days.map((slots) =>
    slots.reduce((sum, s) => sum + slotHeight(s), 0) + Math.max(0, slots.length - 1) * LAYOUT.slotGap + LAYOUT.cellPad * 2,
  );
  return Math.max(label, ...cells);
}

export function scheduleImageHeight(part: ScheduleImagePart) {
  const body = part.rows.length ? part.rows.reduce((sum, r) => sum + rowHeight(r), 0) : LAYOUT.empty;
  return LAYOUT.header + LAYOUT.headRow + body + LAYOUT.footer;
}

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
      (!input.department || s.department_id === input.department),
  );
}

/**
 * Строки картинки: шаблоны, по которым на неделе есть смены, в порядке вида
 * «По шаблонам» (по времени начала или по названию), затем «Другие смены».
 */
export function buildImageRows(input: ScheduleImageInput): ImageRow[] {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(input.week, i));
  const people = new Map(input.people.map((p) => [p.key, p.name]));
  const templates = new Map(
    input.templates
      .filter((t) => !t.archived && (!input.department || t.department_id === input.department))
      .map((t) => [t.id, t]),
  );
  const byRow = new Map<string, ImageShift[]>();
  for (const shift of teamVisibleShifts(input)) {
    const key = shift.template_id && templates.has(shift.template_id) ? shift.template_id : "other";
    byRow.set(key, [...(byRow.get(key) ?? []), shift]);
  }
  const cells = (shifts: ImageShift[], other: boolean, color: string | null) =>
    dates.map((date) =>
      shifts
        .filter((s) => dateInZone(s.starts_at, input.timezone) === date)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || collator.compare(people.get(personKey(a)!) ?? "", people.get(personKey(b)!) ?? ""))
        .map((s) => ({
          // Цвет смены равен текущему цвету её шаблона.
          color: color ?? s.color,
          title: other ? s.title : null,
          name: slotName(people.get(personKey(s)!) ?? ""),
          time: slotTime(timeInZone(s.starts_at, input.timezone), timeInZone(s.ends_at, input.timezone)),
        })),
    ).map(capCell);
  const rows: ImageRow[] = sortTemplates([...templates.values()].filter((t) => byRow.has(t.id)), input.sort ?? DEFAULT_TEMPLATE_SORT)
    .map((t) => ({
      key: t.id,
      title: labelLines(t.name || "Шаблон"),
      subtitle: labelLines(t.subtitle, LABEL_TEXT, LAYOUT.font),
      color: t.color,
      days: cells(byRow.get(t.id)!, false, t.color),
    }));
  const other = byRow.get("other");
  if (other)
    rows.push({ key: "other", title: labelLines("Другие смены", OTHER_TEXT), subtitle: [], color: null, days: cells(other, true, null) });
  return rows;
}

/**
 * Делит строки на картинки по высоте: строки не режутся, картинка не выше
 * `maxBody`. Пустая неделя — одна пустая картинка.
 */
export function splitImageParts(rows: ImageRow[], maxBody: number = LAYOUT.maxBody): ScheduleImagePart[] {
  const parts: ScheduleImagePart[] = [];
  let current: ImageRow[] = [];
  let height = 0;
  for (const row of rows) {
    const h = rowHeight(row);
    if (current.length && height + h > maxBody) {
      parts.push({ rows: current });
      current = [];
      height = 0;
    }
    current.push(row);
    height += h;
  }
  if (current.length || !parts.length) parts.push({ rows: current });
  return parts;
}

export function buildScheduleImage(input: ScheduleImageInput, maxBody: number = LAYOUT.maxBody): ScheduleImage {
  return {
    venueName: input.venueName,
    period: weekPeriodLabel(input.week),
    days: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(input.week, i);
      const weekday = dayLabel(date, { weekday: "short" });
      return { date, weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), day: String(Number(date.slice(8))) };
    }),
    parts: splitImageParts(buildImageRows(input), maxBody),
  };
}

/** Имя файла картинки: «Расписание 23–29 ноября 2026.png», при нескольких — «… · 1 из 2.png». */
export function scheduleImageFileName(image: Pick<ScheduleImage, "period" | "parts">, part: number) {
  const n = image.parts.length;
  return `Расписание ${image.period}${n > 1 ? ` · ${part + 1} из ${n}` : ""}.png`.replace(/[\\/:*?"<>|]/g, " ");
}

/** Подпись к фото в Telegram (HTML). */
export function scheduleImageCaption(image: Pick<ScheduleImage, "venueName" | "period">) {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<b>Расписание на ${escape(image.period)}</b>\n${escape(image.venueName)}`;
}
