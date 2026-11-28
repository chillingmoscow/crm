import { countRu } from "../format/plural.ts";

/** Тон статусной пометки (совпадает с `StatusTone` из status-badge). */
type Tone = "neutral" | "success" | "danger";

/**
 * Подписи истории версий базы знаний: изменение длины текста относительно
 * предыдущей версии и вид правки. Показываются через `StatusBadge`.
 */
export function kbVersionDeltaLabel(delta: number | null): { text: string; tone: Tone } {
  if (delta === null) return { text: "Первая версия", tone: "neutral" };
  if (delta === 0) return { text: "Без изменения длины", tone: "neutral" };
  const chars = countRu(Math.abs(delta), "символ", "символа", "символов");
  return delta > 0 ? { text: `+${chars}`, tone: "success" } : { text: `−${chars}`, tone: "danger" };
}

export function kbChangeKindLabel(kind: string): string {
  switch (kind) {
    case "title":
      return "Заголовок";
    case "properties":
      return "Свойства";
    case "icon":
      return "Значок";
    case "restore":
      return "Восстановление";
    default:
      return "Текст";
  }
}
