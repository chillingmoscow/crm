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

/** Admin toggle «обязательная к прочтению». Гейтится
 *  `kb.manage_required_reading` (миграция 075). Поверх есть RLS на
 *  kb_pages UPDATE — т.е. требуется ещё edit-permission на саму
 *  страницу (kb.edit_any_page или kb.edit_own_pages). Это разумно:
 *  выставляет флаг тот, кто может редактировать саму страницу.
 *
 *  При выключении флага — НЕ удаляем существующие read-records
 *  (они полезны для аудита: «кто прочитал когда страница была обязательной»).
 *
 *  Audit-trail: kb_pages_audit trigger (миграция 074) сейчас не
 *  отдельно логирует toggle required_reading — это update column'а
 *  но без отдельного event-type. Можно добавить отдельным PR. */
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
