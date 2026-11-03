/**
 * Чего не хватает неполному месяцу, словами.
 *
 * Расчёт возвращает устойчивые ID источников (`inventory:<id>`, `shift:<сотрудник>:<дата>`...).
 * Страница не показывает их как есть: человек должен понять, какой акт открыть и чью
 * смену поправить. Неизвестная запись не пропадает - выводится как есть.
 *
 * Без импортов из `@/...`: тест-раннер не резолвит alias из tsconfig.
 */

export type MissingKind = "inventory" | "writeoff" | "shift" | "timezone" | "other";
export type MissingItem = { label: string; href: string | null };
export type MissingGroup = { kind: MissingKind; title: string; items: MissingItem[] };

export type MissingLookup = {
  documents: Map<string, { number: string | null; date: string | null }>;
  employees: Map<string, string>;
};

const TITLES: Record<MissingKind, string> = {
  inventory: "Акты инвентаризации: нет сумм по строкам или склад не привязан к подразделению",
  writeoff: "Акты списаний без плательщика",
  shift: "Смены без должности или отметок",
  timezone: "Расходятся часовые пояса",
  other: "Прочее",
};
const ORDER: MissingKind[] = ["inventory", "writeoff", "shift", "timezone", "other"];

/** `2026-10-31` -> `31.10.2026`. Всё, что не дата, возвращается как есть. */
function dayText(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/** Акт по ID: «Акт ИНВ-15 от 31.10.2026»; если акта нет в справочнике, виден хотя бы его ID. */
export function documentItem(id: string, lookup: MissingLookup): MissingItem {
  const doc = lookup.documents.get(id);
  const label = doc
    ? `Акт ${doc.number ?? id}${doc.date ? ` от ${dayText(doc.date)}` : ""}`
    : `Акт ${id}`;
  return { label, href: `/documents/inventory/${id}` };
}

const TIMEZONE_LABELS: Record<string, string> = { venue: "заведение", writeoffs: "списания", payroll: "ведомость" };

function timezoneItem(ref: string): MissingItem {
  const parts = ref
    .slice("timezone:".length)
    .split(";")
    .map((p) => p.split("="))
    .filter((p) => p.length === 2)
    .map(([k, v]) => `${TIMEZONE_LABELS[k] ?? k} ${v}`);
  return { label: parts.length ? parts.join(", ") : ref, href: null };
}

export function groupMissing(refs: string[], lookup: MissingLookup): MissingGroup[] {
  const groups = new Map<MissingKind, MissingItem[]>();
  const add = (kind: MissingKind, item: MissingItem) => groups.set(kind, [...(groups.get(kind) ?? []), item]);

  for (const ref of refs) {
    if (ref.startsWith("inventory:")) add("inventory", documentItem(ref.slice("inventory:".length), lookup));
    else if (ref.startsWith("writeoff:"))
      add("writeoff", { label: `Акт списания ${ref.slice(ref.lastIndexOf(":") + 1)}`, href: "/documents/writeoffs" });
    else if (ref.startsWith("shift:")) {
      const [, employeeId, date] = ref.split(":");
      const name = lookup.employees.get(employeeId) ?? "Сотрудник без имени в справочнике";
      add("shift", { label: `${name}, ${dayText(date ?? "")}`, href: null });
    } else if (ref.startsWith("timezone:")) add("timezone", timezoneItem(ref));
    else add("other", { label: ref, href: null });
  }
  return ORDER.filter((k) => groups.has(k)).map((kind) => ({ kind, title: TITLES[kind], items: groups.get(kind)! }));
}
