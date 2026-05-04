-- ============================================================
-- 093_kb_emit_page_mentions_per_version.sql
--
-- Релакс идемпотентности page-mention notifications.
--
-- ПРОБЛЕМА: PK kb_page_user_mentions(page_id, user_id) гарантирует,
-- что юзер получит notification ОДИН РАЗ на страницу — навсегда.
-- Если author A упомянул B на page X, а потом удалил mention и снова
-- @-упомянул на следующем save'е — B уведомления уже НЕ получит.
-- Юзер ожидает: каждый «свежий» @-mention в новой версии страницы =
-- свежее уведомление.
--
-- РЕШЕНИЕ: per-version idempotency. Tracking-row живёт по
-- (page_id, user_id, version_id). Каждое сохранение page'а создаёт
-- новый kb_page_versions row → новый tracking-row → новый notif.
-- В пределах одной версии (= debounced auto-save с тем же содержимым)
-- ON CONFLICT DO NOTHING всё ещё защищает от спама.
--
-- COMMENT-MENTIONS не трогаем (миграция 090): comment immutable,
-- existing PK (comment_id, user_id) уже корректен.
-- ============================================================

-- ============================================================
-- 1. Schema migration: add version_id, change PK
-- ============================================================

-- Дроп старого PK перед добавлением колонки. Если кто-то уже добавил
-- эти notification'ы — историю не теряем (rows остаются), просто PK
-- расширяется.
alter table public.kb_page_user_mentions
  drop constraint if exists kb_page_user_mentions_pkey;

alter table public.kb_page_user_mentions
  add column if not exists version_id uuid;

-- Backfill: для существующих rows ставим sentinel'ный version_id
-- (zero-uuid). Это гарантирует, что повторных notif'ов по СТАРЫМ
-- (page,user) парам не пойдёт — sentinel = "старая эпоха". Новые
-- save'ы получат реальный version_id и будут идемпотентны per-version.
update public.kb_page_user_mentions
   set version_id = '00000000-0000-0000-0000-000000000000'
 where version_id is null;

alter table public.kb_page_user_mentions
  alter column version_id set not null;

alter table public.kb_page_user_mentions
  add constraint kb_page_user_mentions_pkey
  primary key (page_id, user_id, version_id);

comment on column public.kb_page_user_mentions.version_id is
  'kb_page_versions.id ИЛИ sentinel 00000000-... для legacy rows. '
  'PK (page_id, user_id, version_id) даёт one-shot per-version: '
  'каждое новое сохранение страницы → потенциально новый notif.';

-- ============================================================
-- 2. RPC kb_emit_page_mentions: + p_version_number, returns int
-- ============================================================
--
-- DROP старой сигнатуры (uuid, uuid[]) → пересоздаём (uuid, uuid[], int).
-- Возвращаем int — количество notif'ов, реально emit'нутых (после
-- on-conflict-do-nothing). Клиент логирует это значение для
-- диагностики «почему до получателя не доехало» (filter active-
-- membership / self-mention / уже notified в этой версии).

drop function if exists public.kb_emit_page_mentions(uuid, uuid[]);

create or replace function public.kb_emit_page_mentions(
  p_page_id        uuid,
  p_user_ids       uuid[],
  p_version_number integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_uid        uuid := auth.uid();
  v_page       record;
  v_link       text;
  v_inserted_user_id uuid;
  v_can_edit_any boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own boolean := public.has_permission('kb.edit_own_pages');
  v_version_id uuid;
  v_emitted    int := 0;
begin
  if v_uid is null then
    return 0;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  select id, slug, title, account_id, created_by into v_page
    from public.kb_pages
   where id = p_page_id
     and account_id = v_account_id
     and deleted_at is null;
  if not found then
    return 0;
  end if;

  -- Edit-permission gate (Codex #61 P1 #1).
  if not (
    v_can_edit_any
    or (v_can_edit_own and v_page.created_by = v_uid)
  ) then
    return 0;
  end if;

  -- Резолвим version_id. Если caller передал version_number — берём
  -- соответствующий kb_page_versions row. Иначе sentinel (legacy-mode):
  -- emit'ит ОДИН РАЗ на (page, user) навсегда — старое поведение.
  if p_version_number is not null then
    select id into v_version_id
      from public.kb_page_versions
     where page_id = p_page_id
       and version_number = p_version_number;
    -- Если version-row ещё не создан (race с триггером kb_save_page)
    -- — fallback на sentinel, чтобы не залипнуть. Per-save-spam
    -- защита тогда вернётся к "one-shot per page" в этом save'е,
    -- но следующий save с реальным version_id отработает корректно.
    if v_version_id is null then
      v_version_id := '00000000-0000-0000-0000-000000000000';
    end if;
  else
    v_version_id := '00000000-0000-0000-0000-000000000000';
  end if;

  v_link := '/knowledge/' || v_page.slug;

  for v_inserted_user_id in
    insert into public.kb_page_user_mentions (page_id, user_id, account_id, version_id)
    select distinct p_page_id, u, v_account_id, v_version_id
      from unnest(p_user_ids) as u
     where u <> v_uid
       and exists (
         select 1 from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = u
           and v.account_id = v_account_id
           and uvr.status = 'active'
       )
    on conflict (page_id, user_id, version_id) do nothing
    returning user_id
  loop
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_inserted_user_id,
      'kb.mention_in_page',
      'Вас упомянули: ' || coalesce(v_page.title, 'без названия'),
      'Вас @-упомянули в странице базы знаний.',
      v_link
    );
    v_emitted := v_emitted + 1;
  end loop;

  return v_emitted;
end;
$$;

comment on function public.kb_emit_page_mentions(uuid, uuid[], integer) is
  'Per-version idempotent emit для @-mention notifications в KB-странице. '
  'Возвращает count emit''нутых notifs — клиент логирует для диагностики. '
  'Sprint D Phase 4b plan §2.7/§2.8, refresh миграция 093.';

revoke all on function public.kb_emit_page_mentions(uuid, uuid[], integer) from public;
grant execute on function public.kb_emit_page_mentions(uuid, uuid[], integer) to authenticated;
