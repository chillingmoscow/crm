-- ============================================================
-- 202_finance_categories_archive.sql
-- Pass B4 (docs/CONVENTIONS.md §2). finance_categories — full archive
-- + hard-delete lifecycle. Children — только transactions (SET NULL
-- (category_id)), hard-delete безопасен (история не теряется).
--
-- Шаги: миграция is_active → archived_at + archived_by, бэкфилл,
-- RLS split (live + archived owner-only), audit-trigger на archived_at
-- переходы + DELETE-ветвь, permission finance.delete_category, drop is_active.
-- ============================================================

-- ── Колонки ───────────────────────────────────────────────────
alter table public.finance_categories
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null
    references public.profiles(id) on delete set null;

comment on column public.finance_categories.archived_at is
  'Soft-archive: NOT NULL — статья скрыта из выборов. Видна только в '
  '/finance/categories/archive у owner''а.';
comment on column public.finance_categories.archived_by is
  'Кто архивировал. SET NULL при удалении профиля.';

-- ── Backfill из is_active ─────────────────────────────────────
update public.finance_categories
   set archived_at = coalesce(updated_at, created_at)
 where is_active = false
   and archived_at is null;

-- partial index — дефолтный фильтр archived_at IS NULL
-- Conflict с finance_categories_type_idx (WHERE is_active=true) → дропнем
-- его и пересоздадим на archived_at IS NULL (тот же смысл).
drop index if exists public.finance_categories_type_idx;
create index if not exists finance_categories_type_idx
  on public.finance_categories (account_id, type)
  where archived_at is null;

create index if not exists finance_categories_account_active_idx
  on public.finance_categories (account_id)
  where archived_at is null;

-- ── Permission ────────────────────────────────────────────────
insert into public.permissions (id, code, module, description)
values (
  '10000000-0000-0000-0000-000000000097',
  'finance.delete_category',
  'finance',
  'Удалять статьи навсегда (hard delete, транзакции теряют ссылку)'
)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'owner' and r.venue_id is null
  and p.code = 'finance.delete_category'
on conflict do nothing;

-- ── RLS ──────────────────────────────────────────────────────
drop policy if exists "finance_categories_select" on public.finance_categories;
create policy "finance_categories_select" on public.finance_categories
  for select
  using (
    archived_at is null
    and account_id = get_active_account_id()
    and (has_permission('finance.view_categories') or has_permission('finance.manage_categories'))
  );

create policy "finance_categories_select_archived_owner" on public.finance_categories
  for select
  using (
    archived_at is not null
    and is_account_owner(account_id)
  );

-- ── Audit-trigger: archived_at переходы + DELETE ветвь ────────
create or replace function public.finance_categories_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.is_system then return NEW; end if;
    v_payload := jsonb_build_object('name', NEW.name, 'type', NEW.type);
    perform public.log_audit('finance.category.created', 'finance_category', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object('name', OLD.name, 'type', OLD.type);
    begin
      perform public.log_audit('finance.category.deleted', 'finance_category', OLD.id, v_payload);
    exception
      when foreign_key_violation then
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    -- archive / restore через archived_at переходы (вместо is_active)
    if OLD.archived_at is null and NEW.archived_at is not null then
      perform public.log_audit(
        'finance.category.archived', 'finance_category', NEW.id,
        jsonb_build_object('name', NEW.name, 'type', NEW.type, 'archived_by', NEW.archived_by)
      );
      return NEW;
    end if;
    if OLD.archived_at is not null and NEW.archived_at is null then
      perform public.log_audit(
        'finance.category.restored', 'finance_category', NEW.id,
        jsonb_build_object('name', NEW.name, 'type', NEW.type)
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
    if OLD.group_id is distinct from NEW.group_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'group_id', 'old', OLD.group_id, 'new', NEW.group_id
      ));
    end if;
    if OLD.color is distinct from NEW.color then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'color', 'old', OLD.color, 'new', NEW.color
      ));
    end if;
    if OLD.icon is distinct from NEW.icon then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'icon', 'old', OLD.icon, 'new', NEW.icon
      ));
    end if;
    if OLD.description is distinct from NEW.description then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'description', 'old', OLD.description, 'new', NEW.description
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object('name', NEW.name, 'changes', v_changes);
      perform public.log_audit('finance.category.updated', 'finance_category', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.finance_categories_audit_trigger() is
  'Audit-trail для public.finance_categories: created/updated/archived/restored/deleted. '
  'archived/restored — переходы archived_at; deleted — hard DELETE.';

drop trigger if exists finance_categories_audit on public.finance_categories;
create trigger finance_categories_audit
  after insert or update or delete on public.finance_categories
  for each row
  execute function public.finance_categories_audit_trigger();

-- ── Drop is_active ────────────────────────────────────────────
alter table public.finance_categories drop column is_active;
