import type { KbBlock } from "@/types/knowledge";

/**
 * BlockNote → Markdown serializer (lossy). Цель — экспорт страницы в
 * одиночный .md файл, который читабельно открывается в любом md-вьюере
 * без потери основного смысла. Не претендует на полное соответствие
 * BlockNote'овскому blocksToMarkdownLossy() — наша версия не зависит
 * от BlockNote-инстанса (его нет на server-side), пишет md прямо из
 * jsonb-структуры блока.
 *
 * Поддержанные блоки:
 *   paragraph, heading[1-6], bulletListItem, numberedListItem,
 *   checkListItem, quote, codeBlock, divider, callout (наш custom),
 *   image, file, table (упрощённо), audio/video (как [audio: name]).
 *
 * Inline: text + styles (bold/italic/underline/strikethrough/code),
 * link.
 */

interface InlineRun {
  type?: string;
  text?: string;
  href?: string;
  content?: InlineRun[];
  styles?: Record<string, boolean | string>;
}

interface BlockLike {
  type?: string;
  props?: Record<string, unknown>;
  content?: InlineRun[] | string | { type: string; rows?: unknown[] };
  children?: BlockLike[];
}

export function blocksToMarkdown(blocks: KbBlock[]): string {
  const out: string[] = [];
  walk(blocks as unknown as BlockLike[], out, 0);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function walk(blocks: BlockLike[], out: string[], depth: number): void {
  let numberedIndex = 0;
  let prevType: string | undefined;
  for (const b of blocks) {
    const md = renderBlock(b, depth, b.type === "numberedListItem" && prevType === "numberedListItem"
      ? ++numberedIndex
      : (b.type === "numberedListItem" ? (numberedIndex = 1) : 0));
    if (md) out.push(md);
    if (b.type !== "numberedListItem") numberedIndex = 0;
    prevType = b.type;

    // Children рендерим как nested список.
    if (Array.isArray(b.children) && b.children.length > 0) {
      const nested: string[] = [];
      walk(b.children, nested, depth + 1);
      // Indent nested список под родителя (4 пробела на уровень,
      // как в CommonMark).
      const indent = "    ".repeat(depth + 1);
      out.push(nested.map((line) => line.split("\n").map((l) => indent + l).join("\n")).join("\n\n"));
    }
  }
}

function renderBlock(b: BlockLike, depth: number, numberedIdx: number): string | null {
  const type = b.type;
  const inline = inlineToMd(Array.isArray(b.content) ? b.content : []);
  const props = b.props ?? {};

  switch (type) {
    case "paragraph":
      return inline || "";

    case "heading": {
      const level = Math.min(Math.max(Number(props.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${inline}`;
    }

    case "bulletListItem":
      return `- ${inline}`;

    case "numberedListItem":
      return `${numberedIdx || 1}. ${inline}`;

    case "checkListItem": {
      const checked = props.checked === true;
      return `- [${checked ? "x" : " "}] ${inline}`;
    }

    case "quote":
      return inline.split("\n").map((l) => `> ${l}`).join("\n");

    case "codeBlock": {
      const lang = typeof props.language === "string" ? props.language : "";
      return ["```" + lang, inline, "```"].join("\n");
    }

    case "divider":
      return "---";

    case "callout": {
      // Наш custom-блок (см. src/components/knowledge/blocks/kb-callout-block.tsx).
      const variant = String(props.variant ?? "info");
      const label = CALLOUT_LABEL[variant] ?? "Подсказка";
      return inline.split("\n").map((l) => `> **${label}.** ${l}`).join("\n");
    }

    case "image": {
      const url = String(props.url ?? "");
      const caption = String(props.caption ?? "");
      const name = String(props.name ?? caption ?? "image");
      return `![${escapeAlt(name)}](${url})${caption ? `\n\n_${escapeMd(caption)}_` : ""}`;
    }

    case "file":
    case "audio":
    case "video": {
      const url = String(props.url ?? "");
      const name = String(props.name ?? type);
      const caption = String(props.caption ?? "");
      const link = url ? `[${escapeAlt(name)}](${url})` : `**${escapeAlt(name)}**`;
      return caption ? `${link}\n\n_${escapeMd(caption)}_` : link;
    }

    case "table":
      return tableToMd(b);

    case "pageBreak":
      return "---";

    default:
      // Unknown block — fall back на inline-content (если есть).
      return inline || null;
  }

  // depth не используется для большинства типов — children
  // обрабатываются отдельно в walk().
  void depth;
}

const CALLOUT_LABEL: Record<string, string> = {
  info: "Инфо",
  warning: "Внимание",
  success: "Готово",
  error: "Ошибка",
};

function inlineToMd(items: InlineRun[]): string {
  return items
    .map((it) => {
      if (it.type === "text" && typeof it.text === "string") {
        return wrapStyles(escapeMd(it.text), it.styles ?? {});
      }
      if (it.type === "link" && Array.isArray(it.content)) {
        return `[${inlineToMd(it.content)}](${it.href ?? ""})`;
      }
      // mention или прочие custom inline — fallback на inner text.
      if (Array.isArray(it.content)) return inlineToMd(it.content);
      if (typeof it.text === "string") return escapeMd(it.text);
      return "";
    })
    .join("");
}

function wrapStyles(text: string, styles: Record<string, boolean | string>): string {
  let out = text;
  if (styles.code) out = "`" + out + "`";
  if (styles.bold) out = "**" + out + "**";
  if (styles.italic) out = "*" + out + "*";
  if (styles.strikethrough) out = "~~" + out + "~~";
  if (styles.underline) out = "<u>" + out + "</u>";
  return out;
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}

function escapeAlt(s: string): string {
  return s.replace(/[\[\]]/g, "");
}

function tableToMd(b: BlockLike): string {
  // BlockNote table content shape: { type: "tableContent", rows: [{cells: [{...inline}, ...]}, ...] }
  const c = b.content as { type?: string; rows?: { cells?: InlineRun[][] }[] } | undefined;
  if (!c?.rows || c.rows.length === 0) return "";
  const rowsMd = c.rows.map((row) =>
    "| " + (row.cells ?? []).map((cell) => inlineToMd(cell).replace(/\n/g, " ")).join(" | ") + " |",
  );
  if (rowsMd.length === 0) return "";
  // Markdown требует отделитель после header. Считаем первый row header.
  const colCount = (c.rows[0].cells ?? []).length;
  const sep = "| " + Array(colCount).fill("---").join(" | ") + " |";
  return [rowsMd[0], sep, ...rowsMd.slice(1)].join("\n");
}
