import type { KbBlock, KbInlineContent } from "@/types/knowledge";

/**
 * Walk a BlockNote document and collect the IDs of all referenced KB
 * pages. Two sources:
 *   1. Custom block of type `page-link` with `props.pageId`.
 *   2. Inline `link` runs whose href matches `/knowledge/[slug]/...`
 *      — but slug → id resolution requires a DB lookup, so we return
 *      the slugs separately and let the caller resolve them.
 *
 * The result is deduplicated.
 */
export function extractBacklinks(content: KbBlock[]): {
  pageIds: string[];
  slugs: string[];
} {
  const pageIds = new Set<string>();
  const slugs = new Set<string>();

  walkBlocks(content, (block) => {
    if (block.type === "page-link") {
      const id = block.props?.pageId;
      if (typeof id === "string" && id.length > 0) pageIds.add(id);
    }

    if (Array.isArray(block.content)) {
      walkInline(block.content, (inline) => {
        if (inline.type === "link" && typeof (inline as { href?: unknown }).href === "string") {
          const href = (inline as { href: string }).href;
          const slug = parseKnowledgeHref(href);
          if (slug) slugs.add(slug);
        }
        // Custom inline-content kbPageMention хранит slug в props
        // напрямую — атомарный chip (см. kb-page-mention.tsx).
        if (inline.type === "kbPageMention") {
          const props = (inline as { props?: { slug?: unknown } }).props;
          if (typeof props?.slug === "string" && props.slug.length > 0) {
            slugs.add(props.slug);
          }
        }
      });
    }
  });

  return {
    pageIds: Array.from(pageIds),
    slugs: Array.from(slugs),
  };
}

/** Match `/knowledge/<slug>` (optional trailing path), return slug or null. */
function parseKnowledgeHref(href: string): string | null {
  // Tolerate absolute (https://app.example.com/knowledge/abc) and relative.
  const match = href.match(/(?:^|\/)knowledge\/([a-z0-9]{4,32})(?:[/?#]|$)/i);
  return match ? match[1] : null;
}

function walkBlocks(blocks: KbBlock[], visit: (b: KbBlock) => void): void {
  for (const block of blocks) {
    visit(block);
    if (Array.isArray(block.children) && block.children.length > 0) {
      walkBlocks(block.children, visit);
    }
  }
}

function walkInline(
  items: KbInlineContent[],
  visit: (i: KbInlineContent) => void
): void {
  for (const item of items) {
    visit(item);
    const nested = (item as { content?: KbInlineContent[] }).content;
    if (Array.isArray(nested)) walkInline(nested, visit);
  }
}
