"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import { generateKbSlug } from "@/lib/knowledge/slug";
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

/** Создаёт новую страницу из шаблона. Доступно всем у кого
 *  `kb.create_pages` (RLS на kb_pages это enforces). Возвращает
 *  slug для редиректа на новую страницу. */
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
  const { pageIds: linkTargets } = extractBacklinks(content);

  // Пытаемся вставить с retry на 23505 (slug collision).
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateKbSlug();
    // Step 1: insert строки страницы.
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
        content: [],
        plain_text: "",
        created_by: user.id,
      })
      .select("id, slug")
      .single();
    if (insErr) {
      if (insErr.code === "23505") continue;
      return { id: null, slug: null, error: insErr.message };
    }

    // Step 2: заливаем content через kb_save_page RPC — тот же
    // путь что у обычного save'а (версионирование, link extraction).
    // plain_text не заполняем — пересчитается на первом edit'е через
    // BlockNote'овский blocksToPlainText.
    const { error: saveErr } = await supabase.rpc("kb_save_page", {
      p_id: page.id,
      p_title: title,
      p_icon: tmpl.icon ?? null,
      p_icon_color: (tmpl.icon_color as string | null) ?? null,
      p_content: content as unknown as never,
      p_plain_text: "",
      p_link_targets: linkTargets,
    } as never);
    if (saveErr) {
      // Страница уже создана как пустая — возвращаем slug, чтобы
      // юзер хотя бы увидел её и мог редактировать.
      return {
        id: page.id,
        slug: page.slug,
        error: `создана пустой: ${saveErr.message}`,
      };
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
