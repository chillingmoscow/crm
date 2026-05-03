"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateKbSlug } from "@/lib/knowledge/slug";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import type { KbBlock } from "@/types/knowledge";

export interface KbTemplateRow {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  content: KbBlock[];
  icon: string | null;
  icon_color: string | null;
  category: string | null;
  is_system_default: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Все шаблоны текущего account. RLS отфильтровывает чужие. Список
 *  доступен всем у кого `kb.view_pages` — даже без manage_templates,
 *  чтобы юзер мог выбрать шаблон при создании страницы. */
export async function listKbTemplates(): Promise<{
  rows: KbTemplateRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_templates")
    .select("*")
    .order("category", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data as unknown as KbTemplateRow[]) ?? [], error: null };
}

/** Создаёт шаблон с нуля или из существующей страницы.
 *  Гейтинг: `kb.manage_templates` (RLS на insert это уже проверяет,
 *  но дублируем для понятной ошибки). */
export async function createKbTemplate(input: {
  name: string;
  description?: string | null;
  content?: KbBlock[];
  icon?: string | null;
  icon_color?: string | null;
  category?: string | null;
  /** Если задан — копируем content/icon/icon_color из этой страницы. */
  source_page_id?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "kb.manage_templates",
  });
  if (!canManage) {
    return { id: null, error: "Нет права управлять шаблонами" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Не авторизован" };

  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return { id: null, error: "Нет активного account" };

  let content = input.content ?? [];
  let icon = input.icon ?? null;
  let iconColor = input.icon_color ?? null;

  // Source page → копируем content + icon. RLS на kb_pages фильтрует
  // чужие — если source_page_id из другого account, .single() вернёт null.
  if (input.source_page_id) {
    const { data: page, error: pageErr } = await supabase
      .from("kb_pages")
      .select("content, icon, icon_color")
      .eq("id", input.source_page_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (pageErr) return { id: null, error: pageErr.message };
    if (!page) return { id: null, error: "Исходная страница не найдена" };
    content = (page.content as unknown as KbBlock[]) ?? [];
    icon = page.icon ?? icon;
    iconColor = (page.icon_color as string | null) ?? iconColor;
  }

  const { data, error } = await supabase
    .from("kb_templates")
    .insert({
      account_id: accountId as unknown as string,
      name: input.name.trim() || "Шаблон без названия",
      description: input.description?.trim() || null,
      content: content as unknown as never,
      icon,
      icon_color: iconColor,
      category: input.category?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };

  revalidatePath("/knowledge");
  return { id: data.id, error: null };
}

/** Удаляет шаблон. */
export async function deleteKbTemplate(
  id: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "kb.manage_templates",
  });
  if (!canManage) {
    return { error: "Нет права управлять шаблонами" };
  }

  const { error } = await supabase.from("kb_templates").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

/** Создаёт новую страницу из шаблона.
 *
 *  Гейтинг: `kb.create_pages` (RLS на kb_pages.insert это enforces).
 *  **edit-permissions НЕ требуются** — content + plain_text пишутся
 *  прямо в INSERT, без двухшагового `kb_save_page` RPC. Это два
 *  бенефита:
 *    1. Роли с create_pages, но без edit_own_pages (теоретически
 *       возможны при кастомных account_role_permissions overrides),
 *       могут пользоваться шаблонами без partial-creation сценария.
 *       См. Codex #45 P2.
 *    2. Один транзакционный шаг → нет состояния «страница создана,
 *       но контент не залился» (Codex #45 P1 не возникает).
 *
 *  Trade-off: первая версия в `kb_page_versions` НЕ создаётся
 *  (стартует с первого реального edit'а), и `kb_page_links` не
 *  заполняется до первого save'а — backlinks из новой страницы на
 *  другие появятся только после edit. Для шаблона приемлемо: версия
 *  «страница как из шаблона» эквивалентна tmpl.content и доступна
 *  через сам шаблон. */
export async function applyKbTemplate(input: {
  template_id: string;
  parent_id: string | null;
  /** Опционально — переопределить title (иначе берём template.name). */
  title?: string;
}): Promise<{ id: string | null; slug: string | null; error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, slug: null, error: "Не авторизован" };

  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) {
    return { id: null, slug: null, error: "Нет активного account" };
  }

  // Тянем шаблон. RLS на kb_templates select разрешает всем в account.
  const { data: tmpl, error: tmplErr } = await supabase
    .from("kb_templates")
    .select("name, content, icon, icon_color")
    .eq("id", input.template_id)
    .maybeSingle();
  if (tmplErr) return { id: null, slug: null, error: tmplErr.message };
  if (!tmpl) {
    return { id: null, slug: null, error: "Шаблон не найден" };
  }

  // Position: max(siblings) + 1 под этим parent_id.
  const { data: maxRow } = await supabase
    .from("kb_pages")
    .select("position")
    .eq("account_id", accountId as unknown as string)
    .is("deleted_at", null)
    .filter("parent_id", input.parent_id ? "eq" : "is", input.parent_id ?? null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;

  const title = input.title?.trim() || tmpl.name || "Без названия";
  const content = (tmpl.content as unknown as KbBlock[]) ?? [];
  // plain_text для FTS считаем здесь же (server-safe: pure walker
  // по jsonb-блокам, без DOM-зависимостей). Без этого новая
  // страница не находилась бы поиском до первого edit'а.
  const plainText = blocksToPlainText(content);

  // Atomic: один INSERT с content + plain_text. RLS на kb_pages
  // .insert уже проверила kb.create_pages.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateKbSlug();
    const { data: page, error: insErr } = await supabase
      .from("kb_pages")
      .insert({
        account_id: accountId as unknown as string,
        parent_id: input.parent_id,
        position: nextPosition,
        title,
        slug,
        icon: tmpl.icon ?? null,
        icon_color: (tmpl.icon_color as string | null) ?? null,
        content: content as unknown as never,
        plain_text: plainText,
        created_by: user.id,
      })
      .select("id, slug")
      .single();
    if (insErr) {
      if (insErr.code === "23505") continue;
      return { id: null, slug: null, error: insErr.message };
    }

    revalidatePath("/knowledge");
    return { id: page.id, slug: page.slug, error: null };
  }

  return {
    id: null,
    slug: null,
    error: "Не удалось сгенерировать уникальный slug",
  };
}
