import type { KbBlock, KbInlineContent } from "@/types/knowledge";

/** UUID-pattern из href'а сотрудника `/people/staff/<uuid>` — формат
 *  inline-link'а, который вставляет KbMentionMenu при выборе человека. */
const STAFF_HREF_RE =
  /^\/people\/staff\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Извлекает уникальные user_id всех @-упомянутых сотрудников из
 *  BlockNote-документа. Walks blocks recursively (вкл. children для
 *  toggle / list-nesting) и inline-content рекурсивно (link.content
 *  тоже массив inline'ов).
 *
 *  @-mention человека рендерится как inline `link` с `href =
 *  /people/staff/<uuid>` (см. KbMentionMenu.buildItem). На этом
 *  pattern и завязываемся.
 *
 *  Sprint D Phase 4b: используется в `saveKbPage` для пуша notifications
 *  через RPC `kb_emit_page_mentions`. Pure-utility, без auth/RPC
 *  зависимостей — может вызываться и с клиента (preview) и с сервера. */
export function extractMentionedUserIds(blocks: KbBlock[]): string[] {
  const ids = new Set<string>();
  walkBlocks(blocks, ids);
  return Array.from(ids);
}

function walkBlocks(blocks: unknown, out: Set<string>): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as { content?: unknown; children?: unknown };
    walkInline(b.content, out);
    walkBlocks(b.children, out);
  }
}

function walkInline(items: unknown, out: Set<string>): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const it = item as Partial<KbInlineContent> & {
      type?: string;
      href?: string;
      content?: unknown;
    };
    if (it.type === "link" && typeof it.href === "string") {
      const m = STAFF_HREF_RE.exec(it.href);
      if (m) out.add(m[1]);
      // link'и могут оборачивать вложенный inline-content — тоже walk.
      walkInline(it.content, out);
    }
  }
}
