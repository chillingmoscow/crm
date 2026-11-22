/**
 * Порядок строк в виде «По шаблонам» и на картинке расписания. Чистый
 * модуль: им пользуются и сетка в браузере, и сервер, рисующий картинку,
 * чтобы в чат уходил тот же порядок, что на экране.
 *
 * «По времени» — сверху вниз по началу смены: раньше всех в неделе
 * выходит — выше. Если у шаблона разное время по дням, берётся самое
 * раннее начало. При равном начале раньше та смена, что раньше кончается
 * (конец после полуночи — это следующий день, позже любого дневного).
 */
import type { TemplateVariant } from "./template-times";

export type TemplateSort = "time" | "name";
export const TEMPLATE_SORTS: readonly TemplateSort[] = ["time", "name"];
export const DEFAULT_TEMPLATE_SORT: TemplateSort = "time";
export const TEMPLATE_SORT_LABELS: Record<TemplateSort, string> = {
  time: "По времени начала",
  name: "По названию",
};

export function isTemplateSort(value: unknown): value is TemplateSort {
  return value === "time" || value === "name";
}

export type SortableTemplate = {
  name: string;
  subtitle: string;
  start_time: string;
  end_time: string;
  variants?: TemplateVariant[] | null;
};

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Начало и конец смены в минутах от полуночи дня начала; конец ≤ начала — уже следующий день. */
function span(start: string, end: string): [number, number] {
  const s = minutes(start);
  const e = minutes(end);
  return [s, e <= s ? e + 24 * 60 : e];
}

/** Самое раннее начало шаблона за неделю (и конец этой же смены). */
export function templateEarliestSpan(t: SortableTemplate): [number, number] {
  const options = t.variants?.length ? t.variants : [{ start_time: t.start_time, end_time: t.end_time }];
  return options
    .map((v) => span(v.start_time, v.end_time))
    .reduce((best, cur) => (cur[0] < best[0] || (cur[0] === best[0] && cur[1] < best[1]) ? cur : best));
}

const byName = (a: SortableTemplate, b: SortableTemplate) =>
  collator.compare(a.name, b.name) || collator.compare(a.subtitle, b.subtitle);

/** Новый массив в выбранном порядке; исходный не меняется. */
export function sortTemplates<T extends SortableTemplate>(list: readonly T[], sort: TemplateSort): T[] {
  if (sort === "name") return [...list].sort(byName);
  const keys = new Map(list.map((t) => [t, templateEarliestSpan(t)]));
  return [...list].sort((a, b) => {
    const [as, ae] = keys.get(a)!;
    const [bs, be] = keys.get(b)!;
    return as - bs || ae - be || byName(a, b);
  });
}
