"use server";

import { revalidatePath } from "next/cache";

import { actionResult, type ActionResult } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";

/**
 * Действия руководителя с обязательной страницей (миграция 416). Право
 * `kb.manage_required_reading`, уведомления и журнал проверяет и пишет
 * сама база; тексты отказов — русские из `raise exception`.
 */

/** Ошибка Supabase приходит объектом, а не Error: actionResult увидел бы
 *  пустой текст и показал общую фразу вместо причины из базы. */
function fail(error: { message: string }): never {
  throw new Error(error.message);
}

export async function requestKbReread(
  pageId: string,
): Promise<ActionResult<{ notified: number }>> {
  return actionResult(async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("kb_request_reread", { p_page_id: pageId });
    if (error) fail(error);
    revalidatePath("/knowledge", "layout");
    return { notified: data ?? 0 };
  }, "Не удалось попросить перечитать страницу");
}

export async function dismissKbReread(pageId: string): Promise<ActionResult<void>> {
  return actionResult(async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("kb_dismiss_reread", { p_page_id: pageId });
    if (error) fail(error);
    revalidatePath("/knowledge", "layout");
  }, "Не удалось отметить, что перечитывать не нужно");
}

export async function remindKbUnread(
  pageId: string,
): Promise<ActionResult<{ notified: number }>> {
  return actionResult(async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("kb_remind_unread", { p_page_id: pageId });
    if (error) fail(error);
    revalidatePath("/knowledge", "layout");
    return { notified: data ?? 0 };
  }, "Не удалось отправить напоминание");
}
