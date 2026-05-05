"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  kbSavePagePropertiesSchema,
  kbSaveTemplatePropertiesSchema,
} from "@/lib/knowledge/schemas";
import type { KbProperty } from "@/types/knowledge";

/** Сохраняет structured-properties страницы. RLS на UPDATE kb_pages
 *  гейтит на `kb.edit_own_pages` / `kb.edit_any_page` — server-side
 *  дублирующая проверка не нужна (RLS вернёт PG-ошибку c понятным
 *  message'ом). */
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.pageId);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

/** Сохраняет properties шаблона. RLS на UPDATE kb_templates гейтит
 *  на `kb.manage_templates` (см. миграцию 070). */
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.templateId);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}
