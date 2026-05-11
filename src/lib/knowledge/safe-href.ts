/** Scheme-allowlist для user-controlled URL'ов, отрендеренных как
 *  `<a href={...}>` в KB-блоках (file, video и т.п.). Поскольку
 *  props блока попадают в DB через BlockNote и edit-flow, любой
 *  редактор страницы может вставить `javascript:` / `data:` URL.
 *  Без проверки export'нутый HTML / read-only render позволяет XSS
 *  на любого читателя.
 *
 *  Разрешённые схемы:
 *   - `http:` / `https:` — обычные внешние ссылки
 *   - `mailto:` / `tel:` — стандартные «действенные» схемы
 *   - `kbfile:` — внутренняя схема для attachment'ов (см.
 *     `KB_FILE_SCHEME` в `gallery/shared.ts`); резолвится в signed
 *     URL на клиенте до того, как реально используется
 *
 *  Всё остальное (включая `javascript:`, `data:`, `vbscript:`,
 *  относительные пути) → `null` (caller рендерит как plain text). */
const SAFE_HREF_SCHEME = /^(https?:|mailto:|tel:|kbfile:)/i;

export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!SAFE_HREF_SCHEME.test(trimmed)) return null;
  return trimmed;
}
