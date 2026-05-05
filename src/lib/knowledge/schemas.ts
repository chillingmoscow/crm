import { z } from "zod";

// Loosely typed BlockNote block. We don't validate the inner shape —
// BlockNote's runtime is the source of truth and a strict schema would
// reject any block we didn't anticipate. We just gate the outer
// envelope (must be array, items have a string `type`).
export const kbBlockSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

export const kbContentSchema = z.array(kbBlockSchema);

// ─── Server-action input schemas ─────────────────────────────────────────────

export const kbPageCreateSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(200).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
});

export const kbPageSaveSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  icon: z.string().trim().max(64).nullable().optional(),
  // Free-form: validation что значение из палитры — на клиенте
  // (KbIconPicker), БД хранит как text. null = нет тинта.
  icon_color: z.string().trim().max(16).nullable().optional(),
  content: kbContentSchema,
  // 1 MB plain-text cap as a soft guard against runaway pages.
  plain_text: z.string().max(1_000_000),
});

export const kbPageMoveSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  position: z.number().int().min(0),
});

export const kbVersionRestoreSchema = z.object({
  page_id: z.string().uuid(),
  version_number: z.number().int().min(1),
});

export const kbSearchSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).optional(),
});

// ─── KB property schemas ─────────────────────────────────────────────────────
// Discriminated union по `type`. Используется server action'ами
// saveKbPageProperties / saveKbTemplateProperties и при apply'е шаблона.
// Каждая property хранит `id` (nanoid(8), стабилен при rename'е).

const kbPropertyBase = {
  id: z.string().min(1).max(32),
  name: z.string().trim().min(1).max(80),
  // Icon override (Stage 2): Lucide-name из реестра KB_ICONS. Если нет —
  // UI рендерит default TYPE_ICONS[type].
  icon: z.string().trim().max(64).optional(),
  // Тинт для Lucide (тот же color-name что у kb_pages.icon_color).
  iconColor: z.string().trim().max(16).optional(),
};

const kbPropertyColorEnum = z.enum([
  "stone",
  "amber",
  "orange",
  "yellow",
  "green",
  "teal",
  "sky",
  "indigo",
  "purple",
  "pink",
]);

export const kbPropertySchema = z.discriminatedUnion("type", [
  z.object({
    ...kbPropertyBase,
    type: z.literal("text"),
    value: z.string().max(2000),
  }),
  z.object({
    ...kbPropertyBase,
    type: z.literal("number"),
    value: z.number().nullable(),
  }),
  z.object({
    ...kbPropertyBase,
    type: z.literal("date"),
    value: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается ISO дата YYYY-MM-DD")
      .nullable(),
  }),
  z.object({
    ...kbPropertyBase,
    type: z.literal("checkbox"),
    value: z.boolean(),
  }),
  z.object({
    ...kbPropertyBase,
    type: z.literal("select"),
    value: z.string().max(200).nullable(),
    options: z.array(z.string().trim().min(1).max(200)).max(50),
    optionColors: z.record(z.string(), kbPropertyColorEnum).optional(),
  }),
  z.object({
    ...kbPropertyBase,
    type: z.literal("multi-select"),
    value: z.array(z.string().max(200)).max(50),
    options: z.array(z.string().trim().min(1).max(200)).max(50),
    optionColors: z.record(z.string(), kbPropertyColorEnum).optional(),
  }),
]);

// Cap на массив — sanity, не функциональное ограничение. На странице
// больше 30 properties — антипаттерн.
export const kbPropertiesSchema = z.array(kbPropertySchema).max(30);

export const kbSavePagePropertiesSchema = z.object({
  pageId: z.string().uuid(),
  properties: kbPropertiesSchema,
});

export const kbSaveTemplatePropertiesSchema = z.object({
  templateId: z.string().uuid(),
  properties: kbPropertiesSchema,
});

export type KbPageCreateParsed = z.infer<typeof kbPageCreateSchema>;
export type KbPageSaveParsed = z.infer<typeof kbPageSaveSchema>;
export type KbPageMoveParsed = z.infer<typeof kbPageMoveSchema>;
export type KbVersionRestoreParsed = z.infer<typeof kbVersionRestoreSchema>;
export type KbSearchParsed = z.infer<typeof kbSearchSchema>;
