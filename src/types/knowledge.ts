// Domain types for the Knowledge Base block.
//
// Mirrors the finance.ts pattern: row shapes are re-exported from the
// generated `Tables<...>`; the `content` jsonb column is narrowed to
// `KbBlock[]` for callers that operate on it as structured BlockNote
// data (server actions / lib modules cast at the boundary).

import type { Tables } from "./database";

// ─── Row shapes (re-exports from generated database.ts) ──────────────────────

export type KbPageRow           = Tables<"kb_pages">;
export type KbPageVersionRow    = Tables<"kb_page_versions">;
export type KbPageLinkRow       = Tables<"kb_page_links">;
export type KbPageAttachmentRow = Tables<"kb_page_attachments">;

// ─── BlockNote content (loosely typed) ───────────────────────────────────────
// The `content` jsonb column is `Json` in the generated types. We don't
// pull the full @blocknote/core types into the server bundle. The shape
// we care about for backlinks/plain-text is just `type`, `content`
// (inline runs), and `props.pageId` for the custom page-link block.

export type KbBlock = {
  id?: string;
  type: string;
  props?: Record<string, unknown> & {
    /** Set by our custom `page-link` block. References kb_pages.id. */
    pageId?: string;
    /** Set by our custom `page-link` block. Cached display title. */
    pageTitle?: string;
    /** Set by our custom `attachment` block. References account_files.id. */
    fileId?: string;
  };
  content?: KbInlineContent[] | string;
  children?: KbBlock[];
};

export type KbInlineContent =
  | { type: "text"; text: string; styles?: Record<string, unknown> }
  | { type: "link"; href: string; content: KbInlineContent[] }
  | { type: string; [key: string]: unknown };

// ─── Form / server-action input shapes ───────────────────────────────────────

export type KbPageCreateInput = {
  parent_id?: string | null;
  title?: string;
  icon?: string | null;
};

export type KbPageSaveInput = {
  id: string;
  title: string;
  icon?: string | null;
  /** Color name from KB_ICON_COLORS. Только для Lucide-иконок;
   *  emoji игнорируют. null = no tint. */
  icon_color?: string | null;
  content: KbBlock[];
  /** Plaintext projection for FTS. Computed on client via blocksToMarkdownLossy. */
  plain_text: string;
};

export type KbPageMoveInput = {
  id: string;
  /** New parent. null = move to root. */
  parent_id: string | null;
  /** 0-based position among new siblings. */
  position: number;
};

// ─── Tree node (returned by lib/knowledge/tree.ts) ───────────────────────────

export type KbTreeNode = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  icon_color: string | null;
  slug: string;
  position: number;
  has_children: boolean;
  /** True если страница заблокирована (locked_at != null). Sprint D
   *  Phase 3 — рисуем lock-icon рядом с заголовком в дереве. */
  is_locked: boolean;
  children: KbTreeNode[];
};

// ─── Search result ───────────────────────────────────────────────────────────

export type KbSearchHit = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  /** ts_headline snippet with <mark>...</mark> around matches. */
  snippet: string;
  rank: number;
};
