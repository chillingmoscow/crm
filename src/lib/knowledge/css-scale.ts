/**
 * Сторож шкалы DS для «своего» CSS (docs/design-system.md: «Типографика»,
 * «Скругления», «Тени»). Разбирает текст CSS на правила и находит кегли,
 * начертания, радиусы и тени вне шкалы. Используется тестом коллекций
 * базы знаний (`collection-styles.test.mts`).
 */

export interface CssDeclaration {
  prop: string;
  value: string;
}

export interface CssRule {
  selector: string;
  declarations: CssDeclaration[];
}

export interface OffScaleDeclaration extends CssDeclaration {
  selector: string;
}

const FONT_SIZES = new Set(["12px", "13px", "14px", "16px", "20px", "28px"]);
const FONT_WEIGHTS = new Set(["400", "500", "600", "700"]);
const RADII = new Set(["0", "4px", "6px", "8px", "10px", "12px", "999px", "9999px", "50%", "inherit"]);

const COLLECTION_START = "/* ── Collection block";
const COLLECTION_END = "/* ──── Плавный переход тем";

function parseDeclarations(body: string): CssDeclaration[] {
  return body
    .split(";")
    .map((part) => {
      const colon = part.indexOf(":");
      if (colon < 0) return null;
      const prop = part.slice(0, colon).trim().toLowerCase();
      const value = part.slice(colon + 1).replace(/!important/g, "").trim();
      return prop && value ? { prop, value } : null;
    })
    .filter((d): d is CssDeclaration => d !== null);
}

/** Правила CSS без комментариев; правила внутри `@media`/`@supports`
 *  возвращаются как обычные (селектор без обёртки). */
export function parseCssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let i = 0;
  const walk = (end: number) => {
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) {
        i = end;
        return;
      }
      const head = text.slice(i, open).trim();
      // Конец блока ищем по глубине скобок.
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const close = j - 1;
      if (head.startsWith("@")) {
        i = open + 1;
        walk(close);
      } else {
        rules.push({
          selector: head.replace(/\s+/g, " "),
          declarations: parseDeclarations(text.slice(open + 1, close)),
        });
      }
      i = close + 1;
    }
  };
  walk(text.length);
  return rules;
}

function isAllowedShadow(value: string): boolean {
  const v = value.trim();
  if (v === "none" || v.startsWith("theme(")) return true;
  // Кольцо выделения — обводка состояния, а не тень (DS «Тени»).
  return v
    .split(/,(?![^(]*\))/)
    .every((part) => /^(inset\s+)?0\s+0\s+0\s+\d+(\.\d+)?px\b/.test(part.trim()));
}

function isAllowed(prop: string, value: string): boolean {
  const v = value.trim();
  if (v.startsWith("var(") || v === "inherit") return true;
  switch (prop) {
    case "font-size":
      return FONT_SIZES.has(v);
    case "font-weight":
      return FONT_WEIGHTS.has(v);
    case "border-radius":
      return v.split(/\s+/).every((part) => RADII.has(part));
    case "box-shadow":
      return isAllowedShadow(v);
    default:
      return true;
  }
}

/** Декларации вне шкалы DS: кегль, начертание, радиус, тень. */
export function offScaleDeclarations(
  rules: CssRule[],
  opts: { selectorIncludes?: string } = {},
): OffScaleDeclaration[] {
  const found: OffScaleDeclaration[] = [];
  for (const rule of rules) {
    if (opts.selectorIncludes && !rule.selector.includes(opts.selectorIncludes)) continue;
    for (const d of rule.declarations) {
      if (!isAllowed(d.prop, d.value)) found.push({ selector: rule.selector, ...d });
    }
  }
  return found;
}

/** Участок коллекций в `globals.css` — между его маркерами. */
export function collectionCss(globalsCss: string): string {
  const start = globalsCss.indexOf(COLLECTION_START);
  const end = globalsCss.indexOf(COLLECTION_END, start);
  if (start < 0 || end < 0) return "";
  return globalsCss.slice(start, end);
}
