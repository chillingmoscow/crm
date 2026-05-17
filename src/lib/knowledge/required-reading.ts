"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface KbReadStatus {
  /** Помечена ли страница как обязательная к прочтению. */
  required: boolean;
  /** Когда current user подтвердил прочтение ТЕКУЩЕЙ версии (null если
   *  не подтверждал ИЛИ прочёл устаревшую версию). */
  myReadAt: string | null;
  /** True если юзер раньше подтверждал ЭТУ страницу, но на старой
   *  версии — а сейчас нужно прочитать заново. UI рендерит другой
   *  банер «Страница обновлена с момента вашего прочтения». */
  needsReread: boolean;
}

/** Read-status текущей страницы для current user. Используется
 *  на /knowledge/[slug] чтобы решить, рендерить ли баннер
 *  «Требуется прочтение» / «Обновлено, нужно перечитать» / badge
 *  «✓ Прочитано».
 *
 *  Под versioning (миграция 097): myReadAt отражает прочтение
 *  ТЕКУЩЕЙ версии (read_version >= current version_number). Если
 *  юзер прочёл старую версию — myReadAt=null, needsReread=true. */
export async function getKbPageReadStatus(
  pageId: string,
): Promise<KbReadStatus> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { required: false, myReadAt: null, needsReread: false };

  // Параллельно: required-flag, current version, моя latest-read row.
  const [{ data: page }, { data: latestVersion }, { data: myRead }] =
    await Promise.all([
      supabase
        .from("kb_pages")
        .select("required_reading")
        .eq("id", pageId)
        .maybeSingle(),
      supabase
        .from("kb_page_versions")
        .select("version_number")
        .eq("page_id", pageId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("kb_page_reads")
        .select("read_at, read_version")
        .eq("page_id", pageId)
        .eq("user_id", user.id)
        .order("read_version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const currentVersion = latestVersion?.version_number ?? 1;
  const myReadVersion = (myRead?.read_version as number | null) ?? null;
  const myReadAt = (myRead?.read_at as string | null) ?? null;

  // Юзер actually прочитал текущую версию только если его read_version
  // >= current. Иначе — needsReread (старая версия) или ещё не читал.
  const isReadCurrent =
    myReadVersion !== null && myReadVersion >= currentVersion;
  const needsReread =
    myReadVersion !== null && myReadVersion < currentVersion;

  return {
    required: Boolean(page?.required_reading),
    myReadAt: isReadCurrent ? myReadAt : null,
    needsReread,
  };
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

export interface KbRequiredReadingCoverage {
  /** Сколько обязательных к прочтению страниц в аккаунте. */
  requiredPages: number;
  /** Размер команды (members активного account). 0 если нет
   *  обязательных страниц — roster берётся через required-reading RPC. */
  teamSize: number;
  /** Сколько членов команды прочитали ВСЕ обязательные страницы
   *  (актуальную версию каждой). */
  done: number;
}

/** Account-level покрытие обязательного чтения для KPI-карточки
 *  «Прочли must-read X / Y» (sheerly `hL8wQ` / `TvInj`).
 *
 *  Версионная сверка как в `getKbRequiredUnreadForUser` (миграция
 *  097): member «прочитал» страницу, если его max(read_version) для
 *  неё ≥ max(version_number) страницы. «done» = прочитал ВСЕ
 *  обязательные. Roster (список членов команды) берём из RPC
 *  `kb_list_required_reading_stats` по первой обязательной странице —
 *  он возвращает всех members account независимо от read-статуса.
 *
 *  Вызывается только из admin-страниц; RPC сам гейтит
 *  `kb.manage_required_reading`, поэтому roster отдаётся только тем,
 *  кто и так видит must-read статистику. */
export async function getKbRequiredReadingCoverage(): Promise<{
  coverage: KbRequiredReadingCoverage;
  error: string | null;
}> {
  const supabase = await createClient();
  const empty: KbRequiredReadingCoverage = {
    requiredPages: 0,
    teamSize: 0,
    done: 0,
  };

  const { data: required, error: reqError } = await supabase
    .from("kb_pages")
    .select("id")
    .eq("required_reading", true)
    .is("deleted_at", null);
  if (reqError) return { coverage: empty, error: reqError.message };

  const requiredIds = (required ?? []).map((r) => r.id as string);
  if (requiredIds.length === 0) {
    return { coverage: { ...empty }, error: null };
  }

  // Roster — все члены команды (RPC возвращает строку на каждого,
  // read_at = null у непрочитавших).
  const { data: roster, error: rosterError } = await supabase.rpc(
    "kb_list_required_reading_stats",
    { p_page_id: requiredIds[0] },
  );
  if (rosterError) return { coverage: empty, error: rosterError.message };
  const memberIds = ((roster ?? []) as { user_id: string }[]).map(
    (r) => r.user_id,
  );

  const [versionsRes, readsRes] = await Promise.all([
    supabase
      .from("kb_page_versions")
      .select("page_id, version_number")
      .in("page_id", requiredIds),
    supabase
      .from("kb_page_reads")
      .select("page_id, user_id, read_version")
      .in("page_id", requiredIds),
  ]);
  if (versionsRes.error)
    return { coverage: empty, error: versionsRes.error.message };
  if (readsRes.error)
    return { coverage: empty, error: readsRes.error.message };

  // max(version_number) на страницу; страницы без versions → 1.
  const maxVer = new Map<string, number>();
  for (const v of (versionsRes.data ?? []) as {
    page_id: string;
    version_number: number;
  }[]) {
    maxVer.set(
      v.page_id,
      Math.max(maxVer.get(v.page_id) ?? 0, v.version_number),
    );
  }
  // max(read_version) на (user, page).
  const maxRead = new Map<string, number>();
  for (const r of (readsRes.data ?? []) as {
    page_id: string;
    user_id: string;
    read_version: number;
  }[]) {
    const key = `${r.user_id}:${r.page_id}`;
    maxRead.set(key, Math.max(maxRead.get(key) ?? 0, r.read_version));
  }

  let done = 0;
  for (const uid of memberIds) {
    const readAll = requiredIds.every((pid) => {
      const need = maxVer.get(pid) ?? 1;
      const got = maxRead.get(`${uid}:${pid}`);
      return got !== undefined && got >= need;
    });
    if (readAll) done += 1;
  }

  return {
    coverage: {
      requiredPages: requiredIds.length,
      teamSize: memberIds.length,
      done,
    },
    error: null,
  };
}
