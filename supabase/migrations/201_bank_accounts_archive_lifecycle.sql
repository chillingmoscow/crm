-- ============================================================
-- 201_bank_accounts_archive_lifecycle.sql
-- Pass B3 жизненного цикла удаления (docs/CONVENTIONS.md §2).
-- Bank accounts — **archive-only по дизайну**: hard-delete блокируется
-- ON DELETE RESTRICT от transactions (миграция 040). Hard-delete action
-- сохранён для случая снятых блокеров, UI показывает RESTRICT и
-- предлагает «Архивировать».
--
-- Колонки soft-delete уже есть с прежних миграций: deleted_at + deleted_by
-- (legacy-имя, не мигрируем — см. docs/CONVENTIONS.md §2).
--
-- Этот PR добавляет:
--   1) Permission finance.delete_bank_account (owner-only).
--   2) Расширение bank_accounts_audit_trigger ветвью DELETE →
--      finance.bank_account.deleted (раньше только INSERT/UPDATE).
-- ============================================================

-- ── Permission ────────────────────────────────────────────────
insert into public.permissions (id, code, module, description)
values (
  '10000000-0000-0000-0000-000000000096',
  'finance.delete_bank_account',
  'finance',
  'Удалять банк-счета навсегда (hard delete, требует отсутствия транзакций)'
)
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'owner' and r.venue_id is null
  and p.code = 'finance.delete_bank_account'
on conflict do nothing;

-- ── Audit-триггер: ветвь DELETE → finance.bank_account.deleted ─
-- Существующий триггер ловит только INSERT/UPDATE (миграция 155).
-- Перевешиваем на INSERT/UPDATE/DELETE + добавляем DELETE-ветвь.
create or replace function public.bank_accounts_audit_trigger()
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
    if NEW.deleted_at is not null then return NEW; end if;
    v_payload := jsonb_build_object(
      'name',     NEW.name,
      'type',     NEW.type,
      'currency', NEW.currency
    );
    perform public.log_audit('finance.bank_account.created', 'bank_account', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name',     OLD.name,
      'type',     OLD.type,
      'currency', OLD.currency
    );
    begin
      perform public.log_audit('finance.bank_account.deleted', 'bank_account', OLD.id, v_payload);
    exception
      when foreign_key_violation then
        -- account cascade-delete (см. venues_audit_trigger §DELETE).
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      perform public.log_audit(
        'finance.bank_account.archived', 'bank_account', NEW.id,
        jsonb_build_object('name', NEW.name, 'type', NEW.type)
      );
      return NEW;
    end if;
    if OLD.deleted_at is not null and NEW.deleted_at is null then
      perform public.log_audit(
        'finance.bank_account.restored', 'bank_account', NEW.id,
        jsonb_build_object('name', NEW.name, 'type', NEW.type)
      );
      return NEW;
    end if;

    -- Diff non-balance полей.
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
    if OLD.bank_name is distinct from NEW.bank_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'bank_name', 'old', OLD.bank_name, 'new', NEW.bank_name
      ));
    end if;
    if OLD.bik is distinct from NEW.bik then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'bik', 'old', OLD.bik, 'new', NEW.bik
      ));
    end if;
    if OLD.account_number is distinct from NEW.account_number then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'account_number', 'old', OLD.account_number, 'new', NEW.account_number
      ));
    end if;
    if OLD.card_holder is distinct from NEW.card_holder then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'card_holder', 'old', OLD.card_holder, 'new', NEW.card_holder
      ));
    end if;
    if OLD.card_number_last4 is distinct from NEW.card_number_last4 then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'card_number_last4', 'old', OLD.card_number_last4, 'new', NEW.card_number_last4
      ));
    end if;
    if OLD.is_active is distinct from NEW.is_active then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'is_active', 'old', OLD.is_active, 'new', NEW.is_active
      ));
    end if;
    if OLD.description is distinct from NEW.description then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'description', 'old', OLD.description, 'new', NEW.description
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit('finance.bank_account.updated', 'bank_account', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.bank_accounts_audit_trigger() is
  'Audit-trail для public.bank_accounts: created/updated/archived/restored/'
  'deleted (hard). Balance changes пропускает.';

drop trigger if exists bank_accounts_audit on public.bank_accounts;
create trigger bank_accounts_audit
  after insert or update or delete on public.bank_accounts
  for each row
  execute function public.bank_accounts_audit_trigger();
