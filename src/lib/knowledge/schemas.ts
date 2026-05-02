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

export type KbPageCreateParsed = z.infer<typeof kbPageCreateSchema>;
export type KbPageSaveParsed = z.infer<typeof kbPageSaveSchema>;
export type KbPageMoveParsed = z.infer<typeof kbPageMoveSchema>;
export type KbVersionRestoreParsed = z.infer<typeof kbVersionRestoreSchema>;
export type KbSearchParsed = z.infer<typeof kbSearchSchema>;
