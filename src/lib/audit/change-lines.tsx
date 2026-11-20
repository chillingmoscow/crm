import { auditFieldLabel, auditFieldValueLabel, formatAuditDate as formatDate } from "./labels";

/** Строки «Поле: было → стало» под событием. Источник — `details.changes`
 *  (массив `{ field, old, new }`), его пишут триггеры и server actions. */
function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (
    ["hired_on","birthday","examined_on","valid_until"].includes(field) ||
    field === "birth_date" ||
    field === "employment_date" ||
    field === "medical_book_date" ||
    field === "business_date" ||
    field === "shift_date" ||
    field === "starts_on" ||
    field === "enabled_from" ||
    field === "deleted_at"
  ) {
    return formatDate(value);
  }
  if (field === "passport_photos") {
    if (Array.isArray(value)) {
      return value.length === 0 ? "—" : `${value.length} фото`;
    }
    return "—";
  }
  if (typeof value === "string") {
    const label = auditFieldValueLabel(field, value);
    if (label !== null) return label;
    // Длинный текст усекаем, чтобы строка не разрослась на полстраницы.
    if (value.length > 60) return value.slice(0, 60) + "…";
    return value;
  }
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

function changeList(details: Record<string, unknown>): FieldChange[] {
  const raw = details.changes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const obj = c as Record<string, unknown>;
      const field = typeof obj.field === "string" ? obj.field : null;
      if (!field) return null;
      return { field, old: obj.old, new: obj.new };
    })
    .filter((x): x is FieldChange => x !== null);
}

export function ChangeLines({ details }: { details: Record<string, unknown> }) {
  const changes = changeList(details);
  if (changes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {changes.map((c, i) => (
        <li key={`${c.field}-${i}`} className="leading-snug">
          <span className="text-foreground">{auditFieldLabel(c.field)}:</span>{" "}
          <span className="line-through">{formatFieldValue(c.field, c.old)}</span>
          {" → "}
          <span className="font-medium text-foreground">
            {formatFieldValue(c.field, c.new)}
          </span>
        </li>
      ))}
    </ul>
  );
}

