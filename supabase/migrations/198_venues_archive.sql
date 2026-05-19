-- ============================================================
-- 198_venues_archive.sql
-- Soft-archive для заведений: archived_at + archived_by.
-- RLS разводит live (всем участникам) и archive (только owner'у).
-- get_active_venue_id / get_active_account_id перестают возвращать
-- архивные venue (иначе RLS у юзера, чьё единственное venue в архиве,
-- продолжит видеть tenant-данные через get_active_account_id-цепочку).
-- venues_audit_trigger расширен событиями venue.archived / .restored.
-- Право hard-delete (org.delete_venue) уже существует с миграции 034
-- и owner-only — не дублируем.
-- См. docs/CONVENTIONS.md §2 «Жизненный цикл удаления».
-- ============================================================

-- ── FK invitations.role_id: RESTRICT → CASCADE ────────────────
-- Зеркало миграции 197 (user_venue_roles.role_id). Цепочка:
--   venues delete → roles.venue_id CASCADE (venue-scoped роли удаляются)
--   → invitations.role_id ON DELETE RESTRICT блокирует.
-- Семантика: удалили роль → отправленные приглашения на эту роль теряют
-- смысл, должны удалиться вместе. invitations.venue_id уже CASCADE
-- (миграция 003), invitations.role_id выравниваем по тому же принципу.
alter table public.invitations
  drop constraint invitations_role_id_fkey;
alter table public.invitations
  add constraint invitations_role_id_fkey
  foreign key (role_id) references public.roles(id) on delete cascade;

-- ── колонки ───────────────────────────────────────────────────
alter table public.venues
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null
    references public.profiles(id) on delete set null;

comment on column public.venues.archived_at is
  'Soft-archive: NOT NULL — заведение скрыто из всех живых списков и '
  'недоступно как active_venue. Видно только в /org/venues/archive у '
  'owner''а. Восстановление — установить NULL.';
comment on column public.venues.archived_by is
  'Кто архивировал. SET NULL при удалении профиля.';

-- partial index ускоряет дефолтный фильтр archived_at IS NULL
create index if not exists venues_account_active_idx
  on public.venues (account_id)
  where archived_at is null;

-- ── RLS ──────────────────────────────────────────────────────
-- venues_select: только live (archived_at IS NULL) для всех (owner+member).
-- Архивные venue в это policy НЕ попадают — они приходят через
-- venues_select_archived_owner ниже (PERMISSIVE → OR).
drop policy if exists "venues_select" on public.venues;
create policy "venues_select" on public.venues
  for select
  using (
    archived_at is null
    and (
      is_account_owner(account_id)
      or exists (
        select 1 from public.user_venue_roles uvr
        where uvr.user_id = (select auth.uid())
          and uvr.venue_id = venues.id
          and uvr.status = 'active'
      )
    )
  );

-- Архивные venue видны только owner'у — для страницы /org/venues/archive.
-- Disjoint с venues_select (archived_at IS NOT NULL vs IS NULL) →
-- multiple_permissive_policies advisor — допустимый сигнал; merge в
-- одну OR-policy расширит видимость member'ов на архив (нежелательно).
create policy "venues_select_archived_owner" on public.venues
  for select
  using (
    archived_at is not null
    and is_account_owner(account_id)
  );

-- ── helper-функции — отказывать на архивных venue ─────────────
-- get_active_venue_id уже не возвращает venue без активного membership.
-- Добавляем дополнительный гард: venue не должен быть архивным.
create or replace function public.get_active_venue_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.active_venue_id
  from public.profiles p
  join public.venues v on v.id = p.active_venue_id
  where p.id = auth.uid()
    and v.archived_at is null
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id = p.active_venue_id
        and uvr.status = 'active'
    );
$$;

-- get_active_account_id зависит от p.active_venue_id → venues.account_id.
-- Если active_venue в архиве, юзер не должен резолвить account_id
-- (иначе RLS других модулей продолжит пускать его в tenant). Добавляем
-- фильтр archived_at IS NULL — теперь функция вернёт NULL, и middleware
-- увидит «нет активного workspace» (стандартный fallback).
create or replace function public.get_active_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select v.account_id
  from public.profiles p
  join public.venues v on v.id = p.active_venue_id
  where p.id = auth.uid()
    and v.archived_at is null;
$$;

-- ── расширяем venues_audit_trigger: archived / restored ───────
-- 'venue.archived' / 'venue.restored' — события переходов archived_at.
-- Остальные UPDATE-события (name/type/address/...) не должны дублировать
-- запись о архивации — если archived_at изменился, шлём только archive/
-- restore (без diff'а полей); это семантически важнее для журнала.
create or replace function public.venues_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_account_id uuid;
  v_venue_id   uuid;
begin
  if TG_OP = 'DELETE' then
    v_account_id := OLD.account_id;
    v_venue_id   := OLD.id;
  else
    v_account_id := NEW.account_id;
    v_venue_id   := NEW.id;
  end if;

  if v_account_id is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'name',    NEW.name,
      'type',    NEW.type,
      'address', NEW.address
    );
    perform public.log_audit_with_context(
      'venue.created', 'venue', NEW.id, v_payload,
      v_account_id, auth.uid(), v_venue_id, null
    );
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name',    OLD.name,
      'type',    OLD.type,
      'address', OLD.address
    );
    begin
      perform public.log_audit_with_context(
        'venue.deleted', 'venue', OLD.id, v_payload,
        v_account_id, auth.uid(), null, null
      );
    exception
      when foreign_key_violation then
        -- account уже удаляется в этой же транзакции — пропускаем
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    -- archive / restore переходы — отдельные события, и в этих случаях
    -- diff остальных полей не шлём (audit становится зашумлённым)
    if OLD.archived_at is null and NEW.archived_at is not null then
      v_payload := jsonb_build_object(
        'name',        NEW.name,
        'archived_by', NEW.archived_by
      );
      perform public.log_audit_with_context(
        'venue.archived', 'venue', NEW.id, v_payload,
        v_account_id, auth.uid(), v_venue_id, null
      );
      return NEW;
    end if;

    if OLD.archived_at is not null and NEW.archived_at is null then
      v_payload := jsonb_build_object('name', NEW.name);
      perform public.log_audit_with_context(
        'venue.restored', 'venue', NEW.id, v_payload,
        v_account_id, auth.uid(), v_venue_id, null
      );
      return NEW;
    end if;

    if OLD.name is distinct from NEW.name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'name', 'old', OLD.name, 'new', NEW.name
      ));
    end if;
    if OLD.type is distinct from NEW.type then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'type', 'old', OLD.type, 'new', NEW.type
      ));
    end if;
    if OLD.address is distinct from NEW.address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'address', 'old', OLD.address, 'new', NEW.address
      ));
    end if;
    if OLD.phone is distinct from NEW.phone then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'phone', 'old', OLD.phone, 'new', NEW.phone
      ));
    end if;
    if OLD.currency is distinct from NEW.currency then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'currency', 'old', OLD.currency, 'new', NEW.currency
      ));
    end if;
    if OLD.timezone is distinct from NEW.timezone then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'timezone', 'old', OLD.timezone, 'new', NEW.timezone
      ));
    end if;
    if OLD.logo_url is distinct from NEW.logo_url then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'logo_url', 'old', OLD.logo_url, 'new', NEW.logo_url
      ));
    end if;
    if OLD.comment is distinct from NEW.comment then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'comment', 'old', OLD.comment, 'new', NEW.comment
      ));
    end if;
    if OLD.default_legal_entity_id is distinct from NEW.default_legal_entity_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_legal_entity_id',
        'old', OLD.default_legal_entity_id,
        'new', NEW.default_legal_entity_id
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit_with_context(
        'venue.updated', 'venue', NEW.id, v_payload,
        v_account_id, auth.uid(), v_venue_id, null
      );
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.venues_audit_trigger() is
  'Audit-trail для public.venues: created / updated (diff полей) / '
  'archived (soft) / restored / deleted (hard). archived/restored — '
  'отдельные события вместо diff archived_at, чтобы журнал читался '
  'по сценарию, а не по полям.';
