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

/** Токен темы (`var(--…)`) задаёт значение из шкалы где-то ещё — его не
 *  проверяем; `inherit` берёт значение родителя. */
function isPassThrough(value: string): boolean {
  return value.startsWith("var(") || value === "inherit";
}

/** `font: [style] [weight] size[/line-height] family` — кегль и начертание
 *  из шортката проверяются как отдельные свойства. */
function fontShorthandParts(value: string): CssDeclaration[] {
  const parts: CssDeclaration[] = [];
  const weight = value.match(/(?:^|\s)(\d{3})(?=\s)/);
  if (weight) parts.push({ prop: "font-weight", value: weight[1] });
  const size = value.match(/(?:^|\s)(\d+(?:\.\d+)?px)(?:\/|\s|$)/);
  if (size) parts.push({ prop: "font-size", value: size[1] });
  return parts;
}

function isAllowed(prop: string, value: string): boolean {
  const v = value.trim();
  if (isPassThrough(v)) return true;
  if (prop === "font-size") return FONT_SIZES.has(v);
  if (prop === "font-weight") return FONT_WEIGHTS.has(v);
  if (prop === "border-radius" || /^border-(top|bottom)-(left|right)-radius$/.test(prop)) {
    return v.split(/\s+/).every((part) => RADII.has(part));
  }
  if (prop === "box-shadow" || prop === "-webkit-box-shadow") return isAllowedShadow(v);
  if (prop === "filter") return !/drop-shadow\(/.test(v);
  return true;
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
      const checked = d.prop === "font" ? fontShorthandParts(d.value) : [d];
      for (const part of checked) {
        if (!isAllowed(part.prop, part.value)) found.push({ selector: rule.selector, ...part });
      }
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
