// Domain types for the Knowledge Base block.
//
// Mirrors the finance.ts pattern: row shapes are re-exported from the
// generated `Tables<...>`; the `content` jsonb column is narrowed to
// `KbBlock[]` for callers that operate on it as structured BlockNote
// data (server actions / lib modules cast at the boundary).

import type { Tables } from "./database";
import type { Unit } from "@/lib/units";

// ─── Row shapes (re-exports from generated database.ts) ──────────────────────

export type KbPageRow           = Tables<"kb_pages">;
export type KbPageVersionRow    = Tables<"kb_page_versions">;
export type KbPageLinkRow       = Tables<"kb_page_links">;
export type KbPageAttachmentRow = Tables<"kb_page_attachments">;

export type KbPageTreeRow = Pick<
  KbPageRow,
  | "id"
  | "parent_id"
  | "position"
  | "title"
  | "icon"
  | "icon_color"
  | "slug"
  | "locked_at"
>;

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

// ─── Page properties (Notion-style typed fields) ─────────────────────────────
// Discriminated union по `type`. Хранятся в kb_pages.properties и
// kb_templates.properties (jsonb-массив). Validation формы — в zod-
// схеме `kbPropertySchema` (см. src/lib/knowledge/schemas.ts).
//
// `id` — nanoid(8), стабилен при rename'е (rename меняет только `name`).
// applyKbTemplate регенерирует `id` чтобы instance был независим от
// template'а.

export type KbPropertyType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multi-select"
  | "url"
  | "rating";

/** Палитра для select-options. Имена — а не tailwind-class'ы — чтобы
 *  хранить в jsonb компактно и стабильно (rename класса в палитре не
 *  ломает уже сохранённые свойства). С версии 115 миграции — alias
 *  для `PaletteColor` из `@/lib/palette` (единая 10-цветная палитра
 *  Notion-style). Маппинг легаси-имён (stone/amber/sky/teal/indigo)
 *  выполняется через `normalizePaletteColor` на чтении. */
export type KbPropertyColor = import("@/lib/palette").PaletteColor;

/** Icon override на уровне property. Lucide-name (см. `KB_ICONS`
 *  в src/lib/knowledge/icons.ts). Если не задан — UI рендерит default
 *  TYPE_ICONS[type]. Optional `iconColor` тинтит Lucide-иконку именем
 *  цвета из KB_ICON_COLORS (тот же color-name, что у kb_pages.icon_color
 *  — для консистентности). Rollback-safe: старый клиент игнорирует. */
interface KbPropertyIconOverride {
  icon?: string;
  iconColor?: string;
}

export type KbPropertyScope =
  | { type: "page" }
  | {
      type: "collection";
      collectionId: string;
      collectionTitle?: string;
      fieldId: string;
    };

interface KbPropertyOwnership {
  /** Logical owner of the property. Missing scope is treated as page-local
   *  for backwards compatibility with existing KB pages and templates. */
  scope?: KbPropertyScope;
}

export type KbProperty =
  | ({
      id: string;
      name: string;
      type: "text";
      value: string;
      /** Сжатое отображение: одна строка с ellipsis. Default `false`
       *  (полное multi-line). Stage 3 polish — toggle в ⋯ menu. */
      collapsed?: boolean;
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "number";
      value: number | null;
      /** Единица измерения (Stage 4). Default отсутствие = `kind: "none"`
       *  (просто число). Discriminated union из shared-слоя
       *  `src/lib/units/`. Хранится в jsonb как-есть. */
      unit?: Unit;
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "date";
      value: string | null; // ISO yyyy-mm-dd
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "checkbox";
      value: boolean;
      /** Визуальный variant. `checkbox` (default) — классический чекбокс,
       *  `switch` — toggle-триггер. Семантика идентична (boolean), меняется
       *  только рендер. Rollback-safe: старый клиент игнорирует и
       *  показывает дефолтный чекбокс. */
      displayVariant?: "checkbox" | "switch";
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "select";
      value: string | null;
      options: string[];
      /** Per-option override цвета. Map от option string → color name.
       *  Если опции нет в map'е — fallback на hash-derived цвет. */
      optionColors?: Partial<Record<string, KbPropertyColor>>;
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "multi-select";
      value: string[];
      options: string[];
      /** Тот же mapping что у select, переиспользуется. */
      optionColors?: Partial<Record<string, KbPropertyColor>>;
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "url";
      value: string;
      /** Сокращённое отображение: убрать `https://` префикс из visible
       *  текста ссылки. Сама href остаётся полной. Default `false` =
       *  показывать как есть. */
      urlCollapsed?: boolean;
    } & KbPropertyIconOverride &
      KbPropertyOwnership)
  | ({
      id: string;
      name: string;
      type: "rating";
      /** Текущее значение от 0 до `max`. null = не задано. */
      value: number | null;
      /** Шкала. По дефолту 5. Допустимые: 3 / 5 / 10. */
      max?: number;
      /** Визуальный variant. `stars` (default) — звёзды, `slider` —
       *  range-input от 0 до max. Семантика та же (число), меняется
       *  только рендер. Rollback-safe. */
      displayVariant?: "stars" | "slider";
    } & KbPropertyIconOverride &
      KbPropertyOwnership);

// ─── Form / server-action input shapes ───────────────────────────────────────

export type KbPageCreateInput = {
  parent_id?: string | null;
  title?: string;
  icon?: string | null;
  /** Optional initial page properties, used by collection records/templates. */
  properties?: KbProperty[];
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
  /** Force a new version row instead of folding into the current edit session. */
  force_new_version?: boolean;
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
