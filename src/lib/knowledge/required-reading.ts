"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface KbReadStatus {
  /** Помечена ли страница как обязательная к прочтению. */
  required: boolean;
  /** Когда current user подтвердил прочтение (null если не подтверждал). */
  myReadAt: string | null;
}

/** Read-status текущей страницы для current user. Используется
 *  на /knowledge/[slug] чтобы решить, рендерить ли баннер
 *  «Требуется прочтение» или badge «✓ Прочитано». */
export async function getKbPageReadStatus(
  pageId: string,
): Promise<KbReadStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { required: false, myReadAt: null };

  // Параллельно: required-flag со страницы + моя запись о прочтении.
  const [{ data: page }, { data: myRead }] = await Promise.all([
    supabase
      .from("kb_pages")
      .select("required_reading")
      .eq("id", pageId)
      .maybeSingle(),
    supabase
      .from("kb_page_reads")
      .select("read_at")
      .eq("page_id", pageId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    required: Boolean(page?.required_reading),
    myReadAt: (myRead?.read_at as string | null) ?? null,
  };
}

/** User подтверждает прочтение страницы. INSERT в kb_page_reads.
 *  Идемпотентно — повторный mark тихо игнорируется (PK conflict 23505).
 *  RLS enforces user_id = auth.uid() + kb.view_pages + page живёт в
 *  active account. */
export async function markKbPageAsRead(
  pageId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return { error: "Нет активного account" };

  const { error } = await supabase.from("kb_page_reads").insert({
    user_id: user.id,
    page_id: pageId,
    account_id: accountId as unknown as string,
  });
  // 23505 = unique_violation: already-marked, идемпотентно ОК.
  if (error && error.code !== "23505") {
    return { error: error.message };
  }

  revalidatePath(`/knowledge`);
  return { error: null };
}

export interface KbRequiredReadingStatsRow {
  user_id: string;
  name: string;
  avatar_url: string | null;
  /** ISO-timestamp когда юзер подтвердил прочтение. NULL = ещё не
   *  прочитал. Записи `kb_page_reads` сохраняются даже если страница
   *  потом перестала быть required, поэтому row'и могут быть
   *  и для уже-не-обязательных страниц. */
  read_at: string | null;
}

/** Список members active account с их read-status'ом по странице.
 *  Прочитавшие — первые (по read_at desc); непрочитавшие — алфавитно.
 *  Гейт `kb.manage_required_reading` — admin-only view; без permission'а
 *  RPC возвращает 0 rows (UI должен redirect'ить — defense in depth).
 *
 *  Sprint D / Phase 2 (план system-reminder-…-moonbeam.md §2.7).
 *  Backed by RPC `kb_list_required_reading_stats` (миграция 080). */
export async function getKbRequiredReadingStats(
  pageId: string,
): Promise<{
  rows: KbRequiredReadingStatsRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "kb_list_required_reading_stats",
    { p_page_id: pageId },
  );
  if (error) return { rows: [], error: error.message };
  const rows: KbRequiredReadingStatsRow[] = (data ?? []).map((r) => {
    const parts = [r.first_name, r.last_name].filter(Boolean) as string[];
    return {
      user_id: r.user_id,
      name: parts.length > 0 ? parts.join(" ") : "—",
      avatar_url: r.avatar_url,
      read_at: r.read_at,
    };
  });
  return { rows, error: null };
}

/** Admin toggle «обязательная к прочтению». Гейтится
 *  `kb.manage_required_reading` (миграция 075). Поверх есть RLS на
 *  kb_pages UPDATE — т.е. требуется ещё edit-permission на саму
 *  страницу (kb.edit_any_page или kb.edit_own_pages). Это разумно:
 *  выставляет флаг тот, кто может редактировать саму страницу.
 *
 *  При выключении флага — НЕ удаляем существующие read-records
 *  (они полезны для аудита: «кто прочитал когда страница была
 *  обязательной»).
 *
 *  Audit-trail: с миграции 080 триггер `kb_pages_audit_trigger`
 *  emit'ит отдельный event `kb_page.required_reading_toggled` на
 *  каждый toggle. */
export async function setKbPageRequiredReading(input: {
  pageId: string;
  required: boolean;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "kb.manage_required_reading",
  });
  if (!canManage) {
    return { error: "Нет права управлять обязательным прочтением" };
  }

  const { error } = await supabase
    .from("kb_pages")
    .update({ required_reading: input.required })
    .eq("id", input.pageId);
  if (error) return { error: error.message };

  revalidatePath(`/knowledge`);
  return { error: null };
}
