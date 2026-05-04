-- ============================================================
-- 097_kb_page_reads_versioning.sql
--
-- Sprint D plan §2.7-A — Re-read flow при обновлении контента.
--
-- Зачем: до этой миграции `kb_page_reads.PK = (user_id, page_id)`.
-- Если admin обновил регламент после того, как сотрудники подтвердили
-- прочтение, новых подтверждений не требуется — сотрудник официально
-- «прочитал» устаревший контент. Compliance-rigor проседает.
--
-- Решение: добавить `read_version` (snapshot version_number из
-- kb_page_versions), расширить PK до (user_id, page_id, read_version).
-- Каждое сохранение страницы создаёт новую версию → новый read нужен.
-- Banner возвращается с надписью «Страница обновлена с момента
-- вашего прочтения. Подтвердите заново».
--
-- Backfill: existing rows получают read_version = 1 (= initial save'ного
-- snapshot'а; реальный version_number из kb_page_versions для старых
-- read'ов мы не знаем, и точная привязка тут не нужна — ROW означает
-- «было прочитано до этой миграции», достаточно отличить от current'а).
--
-- Update'ов и Delete'ов на kb_page_reads нет (compliance-trail) — этот
-- design сохраняется. Multiple rows per (user, page) теперь легитимны,
-- каждый row = одно подтверждение конкретной версии.
-- ============================================================

-- ============================================================
-- 1. Schema: add read_version, change PK
-- ============================================================

alter table public.kb_page_reads
  add column if not exists read_version integer;

-- Backfill: legacy rows (созданные до этой миграции) → version 1.
update public.kb_page_reads
   set read_version = 1
 where read_version is null;

alter table public.kb_page_reads
  alter column read_version set not null,
  alter column read_version set default 1;

-- Drop old PK (user_id, page_id) и пересоздаём с read_version'ом.
alter table public.kb_page_reads
  drop constraint kb_page_reads_pkey;

alter table public.kb_page_reads
  add constraint kb_page_reads_pkey
  primary key (user_id, page_id, read_version);

comment on column public.kb_page_reads.read_version is
  'Snapshot version_number из kb_page_versions на момент подтверждения. '
  'PK расширен до (user_id, page_id, read_version) — после обновления '
  'контента banner возвращается, юзер заново подтверждает. Legacy rows '
  'backfilled = 1. Sprint D §2.7-A, миграция 097.';

-- Index для быстрых "latest read per (user, page)" lookups.
create index if not exists kb_page_reads_latest_idx
  on public.kb_page_reads(user_id, page_id, read_version desc);

-- ============================================================
-- 2. Update kb_list_required_reading_stats RPC
-- ============================================================
--
-- «Кто прочитал» теперь должно учитывать версионность: юзер считается
-- «прочитавшим» только если его latest read_version >= current page
-- version. Иначе = «не прочитал текущую версию» (включая случай когда
-- старая версия была подтверждена, а новая — ещё нет).

create or replace function public.kb_list_required_reading_stats(p_page_id uuid)
returns table (
  user_id    uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  read_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_can_view boolean := public.has_permission('kb.manage_required_reading');
  v_current_version integer;
begin
  if v_account_id is null or auth.uid() is null then
    return;
  end if;
  if not v_can_view then
    return;
  end if;

  if not exists (
    select 1 from public.kb_pages
     where id = p_page_id
       and account_id = v_account_id
       and deleted_at is null
  ) then
    return;
  end if;

  -- Current version = max(version_number) из kb_page_versions. Если
  -- ни одной версии ещё нет (страница без save'ов?) — fallback'ом 1.
  select coalesce(max(version_number), 1)
    into v_current_version
    from public.kb_page_versions
   where page_id = p_page_id;

  return query
  with members as (
    -- Permission-resolution идентичен has_permission() (миграция 022).
    select distinct p.id, p.first_name, p.last_name, p.avatar_url
    from public.profiles p
    join public.user_venue_roles uvr on uvr.user_id = p.id
    join public.venues v on v.id = uvr.venue_id
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions perm
      on perm.id = rp.permission_id and perm.code = 'kb.view_pages'
    join public.roles r on r.id = uvr.role_id
    left join public.account_role_permissions arp
      on r.account_id is null
     and arp.account_id = v_account_id
     and arp.role_id = rp.role_id
     and arp.permission_id = rp.permission_id
    where v.account_id = v_account_id
      and uvr.status = 'active'
      and coalesce(arp.granted, rp.granted) = true
  ),
  latest_reads as (
    -- Latest read per (user, page) для current'а: только rows где
    -- read_version >= current version. Если read есть на старой
    -- версии — НЕ показываем как «прочитал», banner у юзера
    -- вернётся.
    select distinct on (r.user_id)
      r.user_id, r.read_at, r.read_version
    from public.kb_page_reads r
    where r.page_id = p_page_id
      and r.account_id = v_account_id
      and r.read_version >= v_current_version
    order by r.user_id, r.read_version desc
  )
  select
    m.id            as user_id,
    m.first_name,
    m.last_name,
    m.avatar_url,
    lr.read_at
  from members m
  left join latest_reads lr on lr.user_id = m.id
  order by
    lr.read_at desc nulls last,
    m.first_name nulls last,
    m.last_name  nulls last;
end;
$$;

comment on function public.kb_list_required_reading_stats(uuid) is
  'Admin-view «кто прочитал» для KB-страницы. Возвращает members + '
  'их read_at если read_version >= current. Под versioning (миграция '
  '097): прочитавшие старую версию considered «не прочитали» текущую. '
  'Гейт kb.manage_required_reading.';
