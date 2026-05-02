import type { KbBlock } from "@/types/knowledge";

/**
 * Cheap BlockNote → plain-text projection. Walks blocks/inline runs
 * and concatenates `text` content with newlines between blocks.
 * Loses formatting, lists, code-block fences, table layout — that's
 * the point: callers want either an FTS index payload or a snippet
 * preview, not perfect Markdown.
 *
 * Used by:
 *   - blocknote-editor.tsx — onChange → server saves plain_text.
 *   - kb-version-history.tsx — preview snippet of each version.
 */
export function blocksToPlainText(blocks: KbBlock[]): string {
  const out: string[] = [];
  walk(blocks, out);
  return out.join("\n").trim();
}

function walk(blocks: KbBlock[], out: string[]): void {
  for (const block of blocks) {
    if (typeof block.content === "string") {
      out.push(block.content);
    } else if (Array.isArray(block.content)) {
      const line: string[] = [];
      collectInline(block.content, line);
      if (line.length > 0) out.push(line.join(""));
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      walk(block.children, out);
    }
  }
}

function collectInline(items: unknown[], out: string[]): void {
  for (const raw of items) {
    const item = raw as { type?: string; text?: string; content?: unknown[] };
    if (item.type === "text" && typeof item.text === "string") {
      out.push(item.text);
    } else if (Array.isArray(item.content)) {
      collectInline(item.content, out);
    }
  }
}
