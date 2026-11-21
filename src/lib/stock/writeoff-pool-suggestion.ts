import type { WriteoffKind } from "./writeoffs.ts";
import type { WriteoffPoolAssignment } from "./writeoff-pools.ts";

/**
 * Подсказка «кто платит» по типу акта в Quick Resto.
 *
 * Только предложение для формы: ничего не сохраняет и в расчёт не идёт. Акт
 * без пометки остаётся «Не разнесён», пока человек не нажмёт «Сохранить»
 * (решение владельца: программа не угадывает, кто виноват, а помогает выбрать).
 * Поэтому при любой неоднозначности подсказки нет: лучше пустое поле, чем
 * уверенно подставленный не тот человек.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

export type WriteoffPoolSuggestion = {
  pool: WriteoffPoolAssignment["pool"];
  /** Подразделение для "department", сотрудник для "personal", иначе null. */
  key: string | null;
};

export type WriteoffSuggestionTargets = {
  departments: Array<{ id: string; name: string; archived: boolean }>;
  employees: Array<{
    id: string;
    name: string;
    active: boolean;
    /** ID сотрудника в Quick Resto (`payroll_employees.quickresto_id`). */
    quickrestoId?: number | null;
  }>;
};

/** Версия правил удержаний: нужна только раскладка групп по подразделениям. */
export type WriteoffSuggestionRuleVersion = {
  version: number;
  valid_from: string;
  groups: Array<{ id: string; name: string; departmentIds?: string[] }>;
};

/** Название группы и вида акта «Кальянные мастера» (`writeoffKindLabels.masters`). */
const MASTERS_NAME = "кальянные мастера";

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

/** Имя без учёта порядка слов: «Иванов Иван» = «Иван Иванов». */
const nameKey = (s: string) => norm(s).split(" ").filter(Boolean).sort().join(" ");

/** Версия правил, действующая на дату: самая поздняя `valid_from <= asOf`, при равенстве - старшая. */
function ruleVersionOn<T extends { version: number; valid_from: string }>(
  versions: readonly T[],
  asOf: string,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.valid_from > asOf) continue;
    if (
      !best ||
      v.valid_from > best.valid_from ||
      (v.valid_from === best.valid_from && v.version > best.version)
    )
      best = v;
  }
  return best;
}

/**
 * Подразделения кальянных мастеров по правилам удержаний на дату акта: группа
 * с ID `masters` (её создаёт перенос прежних правил) или с названием
 * «Кальянные мастера». Пусто, если такой группы нет или у неё нет подразделений.
 */
export function masterDepartmentIds(
  versions: readonly WriteoffSuggestionRuleVersion[],
  asOf: string,
): string[] {
  const rule = ruleVersionOn(versions, asOf);
  if (!rule) return [];
  const ids = rule.groups
    .filter((g) => g.id === "masters" || norm(g.name) === MASTERS_NAME)
    .flatMap((g) => g.departmentIds ?? []);
  return [...new Set(ids)];
}

/** Ровно один кандидат - подсказка; ноль или несколько - подсказки нет. */
const single = <T>(list: T[]): T | null => (list.length === 1 ? list[0] : null);

/**
 * Подсказка по виду акта:
 * - личное потребление и «за счёт заведения» → «Не удерживать»;
 * - «Вся команда» → «Вся команда»;
 * - «Сотрудник» → этот сотрудник, если он однозначно находится среди
 *   действующих сотрудников заведения (сначала по ID в Quick Resto, потом по
 *   имени без учёта порядка слов);
 * - «Кальянные мастера» → подразделение, если оно однозначно: единственное
 *   действующее подразделение группы мастеров в правилах удержаний, а если в
 *   правилах его нет - единственное подразделение с названием «Кальянные мастера»;
 * - «Нужно уточнить» и всё неоднозначное → null.
 */
export function suggestWriteoffPool(
  doc: {
    kind: WriteoffKind;
    operatorId: number | null;
    operatorName: string | null;
  },
  targets: WriteoffSuggestionTargets,
  opts: { masterDepartmentIds?: readonly string[] } = {},
): WriteoffPoolSuggestion | null {
  switch (doc.kind) {
    case "personal":
    case "business":
      return { pool: "excluded", key: null };
    case "team":
      return { pool: "shared", key: null };
    case "employee": {
      const active = targets.employees.filter((e) => e.active);
      const byId =
        doc.operatorId === null
          ? []
          : active.filter((e) => e.quickrestoId === doc.operatorId);
      // ID в Quick Resto однозначен; совпадений больше одного быть не должно,
      // но если есть - это не повод выбирать по имени.
      if (byId.length > 0) {
        const e = single(byId);
        return e ? { pool: "personal", key: e.id } : null;
      }
      const name = doc.operatorName ? nameKey(doc.operatorName) : "";
      if (!name) return null;
      const e = single(active.filter((x) => nameKey(x.name) === name));
      return e ? { pool: "personal", key: e.id } : null;
    }
    case "masters": {
      const live = targets.departments.filter((d) => !d.archived);
      const fromRules = new Set(opts.masterDepartmentIds ?? []);
      if (fromRules.size > 0) {
        // Правила назвали подразделения: выбираем только среди них.
        const d = single(live.filter((x) => fromRules.has(x.id)));
        return d ? { pool: "department", key: d.id } : null;
      }
      const d = single(live.filter((x) => norm(x.name) === MASTERS_NAME));
      return d ? { pool: "department", key: d.id } : null;
    }
    default:
      return null;
  }
}
