-- ============================================================
-- 078_kb_page_lock.sql
-- Sprint D / Phase 3 — Page Lock (защита от случайных правок).
--
-- Зачем: KB сейчас полностью live-edit, авто-сохранение каждые 2 сек.
-- Готовый регламент можно случайно зацепить курсором / drag-handle'ом
-- и испортить — без визуального отката кроме version-history. Notion-
-- style решение: admin блокирует страницу → она read-only для всех,
-- включая автора, до явной разблокировки.
--
-- Что:
--   • alter table kb_pages — две колонки `locked_at` + `locked_by`
--   • permission `kb.lock_pages` (UUID …000063), default owner /
--     admin / manager (manage_required_reading = manage_lock логика
--     одинаковая: те же роли решают «закрепить как готовое»)
--   • RPC `kb_save_page` (миграция 062) — добавляем guard в начало:
--     если `locked_at is not null` И caller не имеет `kb.lock_pages`
--     → reject. Caller с lock-правом может всё равно сохранить (он
--     же может разблокировать), но UI должен явно показать banner
--     «вы редактируете заблокированную страницу».
--
-- Audit-event `kb_page.locked` / `unlocked` — в отдельной миграции
-- 082, чтобы не конфликтовать с 080 (Phase 2) которая тоже трогает
-- `kb_pages_audit_trigger` тело. См. комментарий в 082.
-- ============================================================

-- ============================================================
-- 1. Колонки kb_pages
-- ============================================================

alter table public.kb_pages
  add column if not exists locked_at  timestamptz,
  add column if not exists locked_by  uuid references auth.users(id) on delete set null;

comment on column public.kb_pages.locked_at is
  'Когда страница заблокирована для редактирования. NULL = разблокирована. '
  'Toggled через server-action под kb.lock_pages permission. RPC kb_save_page '
  'отвергает write на locked-странице если caller не имеет kb.lock_pages.';

comment on column public.kb_pages.locked_by is
  'Кто заблокировал страницу (FK auth.users). Используется в banner '
  '«Заблокировано <именем>». ON DELETE SET NULL — если автор blocker''а '
  'удалён, lock остаётся, но atribution стирается.';

-- Partial index для быстрого фильтра «все заблокированные в account'е»
-- (для dashboard / aggregation). Маленькая таблица — не критично, но
-- pattern из 075 для required_reading_idx.
create index if not exists kb_pages_locked_idx
  on public.kb_pages(account_id)
  where locked_at is not null and deleted_at is null;

-- ============================================================
-- 2. Permission kb.lock_pages
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000063',
   'kb.lock_pages',
   'Блокировать / разблокировать страницы для защиты от случайных правок',
   'kb');

-- Default-матрица: owner / admin / manager. accountant — НЕТ (kb-
-- регламенты не его зона); hostess / waiter — НЕТ (только потребители).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000063'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000002'::uuid)   -- manager
) as r(role_id);

-- ============================================================
-- 3. Updated kb_save_page — с lock guard
-- ============================================================
--
-- Полное тело копируется из 062 (последняя версия) + добавлен
-- блок проверки lock-state в начале, после permission-check'а.
-- DROP + CREATE — хотя сигнатура та же, явный drop полезен для
-- идемпотентности при повторных накатах в dev-среде.

drop function if exists public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]);

create or replace function public.kb_save_page(
  p_id            uuid,
  p_title         text,
  p_icon          text,
  p_icon_color    text,
  p_content       jsonb,
  p_plain_text    text,
  p_link_targets  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_account_id       uuid := public.get_active_account_id();
  v_page             public.kb_pages%rowtype;
  v_can_edit_any     boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own     boolean := public.has_permission('kb.edit_own_pages');
  v_can_lock         boolean := public.has_permission('kb.lock_pages');
  v_changed          boolean;
  v_next_version     integer;
begin
  if v_uid is null then
    raise exception 'kb_save_page: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_save_page: нет активного account' using errcode = '28000';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
  if not found then
    raise exception 'kb_save_page: страница % не найдена', p_id using errcode = 'P0002';
  end if;
  if v_page.account_id != v_account_id then
    raise exception 'kb_save_page: страница принадлежит другому account' using errcode = '42501';
  end if;
  if not (
    v_can_edit_any
    or (v_can_edit_own and v_page.created_by = v_uid)
  ) then
    raise exception 'kb_save_page: нет права на редактирование' using errcode = '42501';
  end if;

  -- Lock guard (Sprint D Phase 3). Если страница заблокирована —
  -- пускаем только тех, у кого `kb.lock_pages` permission. Они
  -- осознанно знают что обходят защиту (UI показывает banner).
  -- Без права — exception, save отвергнут.
  if v_page.locked_at is not null and not v_can_lock then
    raise exception
      'kb_save_page: страница заблокирована (locked_at = %)',
      v_page.locked_at
      using errcode = '42501',
            hint = 'Снимите блокировку через kb.lock_pages permission или '
                   'попросите admin''а разблокировать страницу';
  end if;

  -- Контент / title / icon / icon_color изменились?
  v_changed :=
    coalesce(v_page.title, '') is distinct from coalesce(p_title, '')
    or coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '')
    or coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '')
    or v_page.content is distinct from p_content;

  update public.kb_pages
     set title       = p_title,
         icon        = p_icon,
         icon_color  = p_icon_color,
         content     = p_content,
         plain_text  = p_plain_text,
         updated_by  = v_uid
   where id = p_id;

  -- Снапшот версии — только если что-то поменялось.
  if v_changed then
    select coalesce(max(version_number), 0) + 1
      into v_next_version
      from public.kb_page_versions
     where page_id = p_id;

    insert into public.kb_page_versions (
      page_id, account_id, version_number, title, content, created_by
    ) values (
      p_id, v_account_id, v_next_version, p_title, p_content, v_uid
    );
  else
    select coalesce(max(version_number), 0) into v_next_version
      from public.kb_page_versions where page_id = p_id;
  end if;

  -- Backlinks: replace в одной TX.
  delete from public.kb_page_links where from_page_id = p_id;

  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, t, v_account_id
      from unnest(p_link_targets) as t
     where t != p_id
       and exists (
         select 1 from public.kb_pages
          where id = t and account_id = v_account_id
       )
    on conflict do nothing;
  end if;

  return v_next_version;
end;
$$;

comment on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) is
  'Атомарное сохранение KB-страницы: контент + версия + backlinks. '
  'С 078 — отвергает save на locked-странице если caller не имеет '
  'kb.lock_pages permission. Возвращает version_number текущего снапшота.';

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[])
  to authenticated;

-- ============================================================
-- 4. RPC kb_set_page_lock — единственный путь toggle'а
-- ============================================================
--
-- Без этой RPC client ходил бы напрямую через `kb_pages.update`,
-- что упирается в существующую RLS-policy `kb_pages_update`
-- (миграция 055): UPDATE разрешён только под `kb.edit_any_page` /
-- `kb.edit_own_pages` / `kb.delete_pages`. Manager в 078 получил
-- `kb.lock_pages`, но НЕ `kb.edit_any_page` — UI бы показал toggle,
-- а update реджектился RLS. См. Codex #59 P1.
--
-- Решение: security-definer RPC, который check'ает kb.lock_pages
-- и пишет UPDATE из-под supabase_admin (RLS не применяется к owner'у
-- таблицы внутри security-definer-функции).

create or replace function public.kb_set_page_lock(
  p_page_id uuid,
  p_locked  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_permission('kb.lock_pages') then
    raise exception 'kb.lock_pages permission required' using errcode = '42501';
  end if;

  -- Page обязан жить в active account, иначе cross-tenant trick.
  if not exists (
    select 1 from public.kb_pages
     where id = p_page_id
       and account_id = v_account_id
       and deleted_at is null
  ) then
    raise exception 'Page not found or not accessible' using errcode = '42704';
  end if;

  if p_locked then
    update public.kb_pages
       set locked_at = now(),
           locked_by = v_uid
     where id = p_page_id;
  else
    update public.kb_pages
       set locked_at = null,
           locked_by = null
     where id = p_page_id;
  end if;
end;
$$;

comment on function public.kb_set_page_lock(uuid, boolean) is
  'Toggle lock-state KB-страницы. Security definer — обходит '
  'kb_pages_update RLS-policy (которая требует edit-any/edit-own/'
  'delete-pages). Гейт через kb.lock_pages permission + page живёт '
  'в active account. Audit-event пишется триггером (миграция 082).';

revoke all on function public.kb_set_page_lock(uuid, boolean) from public;
grant execute on function public.kb_set_page_lock(uuid, boolean) to authenticated;
