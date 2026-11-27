"use server";

import { revalidatePath } from "next/cache";

import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import type { KbReadingStatus } from "@/lib/knowledge/reading-state";

/** Сумма активных секунд текущего юзера по странице (накопленная за
 *  все визиты, считает сервер). Read-gate обязательного чтения
 *  ориентируется на это, а не на свежий per-mount таймер — иначе
 *  повторный заход / обновление страницы требовали бы вычитывать
 *  порог заново. Backed by RPC kb_my_active_seconds (миграция 183). */
export async function getKbMyActiveSeconds(
  pageId: string,
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_my_active_seconds", {
    p_page_id: pageId,
  });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

/** User подтверждает прочтение страницы. INSERT в kb_page_reads с
 *  read_version = current latest version_number из kb_page_versions.
 *  Если строка для (user, page, version) уже есть — идемпотентно ОК
 *  (PK conflict 23505). RLS enforces user_id = auth.uid() +
 *  kb.view_pages + page живёт в active account. */
export async function markKbPageAsRead(
  pageId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return { error: "Нет активного account" };

  // Резолвим current version. Если ни одной версии ещё нет (страница
  // без save'ов — теоретически возможно для свежесозданной) — fallback
  // на 1, тот же default что в migration 097.
  const { data: latestVersion } = await supabase
    .from("kb_page_versions")
    .select("version_number")
    .eq("page_id", pageId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const readVersion =
    (latestVersion?.version_number as number | null) ?? 1;

  const { error } = await supabase.from("kb_page_reads").insert({
    user_id: user.id,
    page_id: pageId,
    account_id: accountId as unknown as string,
    read_version: readVersion,
  });
  // 23505 = unique_violation: already-marked этой версии, идемпотентно.
  if (error && error.code !== "23505") {
    return { error: error.message };
  }

  // "layout": счётчик «К прочтению» живёт в дереве (layout раздела).
  revalidatePath("/knowledge", "layout");
  return { error: null };
}

export interface KbRequiredReadingStatsRow {
  user_id: string;
  name: string;
  avatar_url: string | null;
  /** Когда подтвердил действующее прочтение; null — не читал или
   *  попросили перечитать. */
  read_at: string | null;
  /** read — прочитал, reread — попросили перечитать, unread — не читал. */
  status: KbReadingStatus;
  roleName: string | null;
}

/** Список members active account с их read-status'ом по странице.
 *  Состав — kb_required_reading_roster (активные, не уволенные, с
 *  kb.view_pages). Прочитавшие — первые (по read_at desc), остальные —
 *  по алфавиту.
 *  Гейт `kb.manage_required_reading` — admin-only view; без permission'а
 *  RPC возвращает 0 rows (UI должен redirect'ить — defense in depth).
 *
 *  Sprint D / Phase 2 (план system-reminder-…-moonbeam.md §2.7).
 *  Backed by RPC `kb_list_required_reading_stats` (миграция 416). */
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
      status: r.status,
      roleName: r.role_name,
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

  const canManage = (await getCachedPermissionChecker())("kb.manage_required_reading");
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

export interface KbRequiredReadingOverviewRow {
  pageId: string;
  slug: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  currentVersion: number;
  /** Сколько человек должны прочитать (состав аккаунта). */
  total: number;
  readCount: number;
  /** Прочитали раньше, но их попросили перечитать. */
  rereadCount: number;
  /** Не открывали подтверждение ни разу. */
  unreadCount: number;
  /** Прочитали не последнюю версию — их сбросит и уведомит «Попросить
   *  перечитать» (без того, кто смотрит). */
  staleCount: number;
  /** Кому уйдёт «Напомнить»: без действующего прочтения, кроме смотрящего. */
  remindCount: number;
  /** Страницу правили после чьего-то действующего прочтения, и менеджер
   *  ещё не ответил «Попросить перечитать» или «Не нужно». */
  changedAfterRead: boolean;
  remindedAt: string | null;
  lastEditedAt: string | null;
}

/** Сводка по обязательным страницам аккаунта (или одной странице) для
 *  руководителя с `kb.manage_required_reading`; без права RPC отдаёт
 *  пусто. Ошибка не роняет страницу: пишем в лог сервера и отдаём []. */
export async function getKbRequiredReadingOverview(
  pageId?: string,
): Promise<KbRequiredReadingOverviewRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "kb_required_reading_overview",
    pageId ? { p_page_id: pageId } : {},
  );
  if (error) {
    console.error("[kb] сводка обязательного чтения:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    pageId: r.page_id,
    slug: r.slug,
    title: r.title,
    icon: r.icon,
    iconColor: r.icon_color,
    currentVersion: r.current_version,
    total: r.total,
    readCount: r.read_count,
    rereadCount: r.reread_count,
    unreadCount: r.unread_count,
    staleCount: r.stale_count,
    remindCount: r.remind_count,
    changedAfterRead: r.changed_after_read,
    remindedAt: r.reminded_at,
    lastEditedAt: r.last_edited_at,
  }));
}
