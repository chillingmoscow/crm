"use server";

import { createClient } from "@/lib/supabase/server";
import {
  kbSavePagePropertiesSchema,
  kbSaveTemplatePropertiesSchema,
} from "@/lib/knowledge/schemas";
import type { KbProperty } from "@/types/knowledge";

/** Сохраняет structured-properties страницы. RLS на UPDATE kb_pages
 *  гейтит на `kb.edit_own_pages` / `kb.edit_any_page` — server-side
 *  дублирующая проверка не нужна (RLS вернёт PG-ошибку c понятным
 *  message'ом).
 *
 *  ВАЖНО: НЕ бампим `updated_at` и НЕ дёргаем `revalidatePath`. Иначе
 *  RSC-fetch перерендерит [slug]/page.tsx, KbPageEditor с
 *  `key={pageId-updatedAt}` ремонтится → BlockNote и `<KbPageProperties>`
 *  пересоздаются → пользовательские несохранённые правки в других
 *  свойствах теряются, на экране дёрганье. Локальный state клиента уже
 *  имеет последние значения — refetch не нужен. */
export async function saveKbPageProperties(input: {
  pageId: string;
  properties: KbProperty[];
}): Promise<{ error: string | null }> {
  const parsed = kbSavePagePropertiesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Невалидные свойства" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("kb_pages")
    .update({
      properties: parsed.data.properties as unknown as never,
    })
    .eq("id", parsed.data.pageId);
  if (error) return { error: error.message };

  return { error: null };
}

/** Сохраняет properties шаблона. RLS на UPDATE kb_templates гейтит
 *  на `kb.manage_templates` (см. миграцию 070). По тем же причинам, что
 *  и saveKbPageProperties — БЕЗ `updated_at` и `revalidatePath`. */
export async function saveKbTemplateProperties(input: {
  templateId: string;
  properties: KbProperty[];
}): Promise<{ error: string | null }> {
  const parsed = kbSaveTemplatePropertiesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Невалидные свойства" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("kb_templates")
    .update({
      properties: parsed.data.properties as unknown as never,
    })
    .eq("id", parsed.data.templateId);
  if (error) return { error: error.message };

  return { error: null };
}
