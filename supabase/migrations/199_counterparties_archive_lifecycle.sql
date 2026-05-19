-- ============================================================
-- 199_counterparties_archive_lifecycle.sql
-- Pass B1 жизненного цикла удаления (см. docs/CONVENTIONS.md §2):
--   - Permission finance.delete_counterparty (owner-only) для hard-delete.
--   - Расширение counterparties_audit_trigger ветвью DELETE →
--     finance.counterparty.deleted (сейчас триггер ловит только
--     INSERT/UPDATE, hard-delete не пишет в audit).
-- Колонка для soft-delete у counterparties уже есть (deleted_at,
-- legacy-имя; не мигрируем по решению CONVENTIONS).
-- ============================================================

-- ── Permission ────────────────────────────────────────────────
insert into public.permissions (id, code, module, description)
values (
  '10000000-0000-0000-0000-000000000095',
  'finance.delete_counterparty',
  'finance',
  'Удалять контрагентов навсегда (hard delete с каскадом)'
)
on conflict (code) do nothing;

-- Грант owner-only (system-role marker — venue_id IS NULL)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'owner' and r.venue_id is null
  and p.code = 'finance.delete_counterparty'
on conflict do nothing;

-- ── Audit-триггер: ветвь DELETE → finance.counterparty.deleted ─
-- Существующий триггер (миграция 155) обрабатывает только
-- INSERT/UPDATE и навешан только на эти команды. Перевешиваем
-- на INSERT/UPDATE/DELETE и добавляем DELETE-ветвь. Остальные
-- ветви оставляем как есть (диффы по полям, archive/restore через
-- переходы deleted_at NULL ↔ NOT NULL).
create or replace function public.counterparties_audit_trigger()
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
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.deleted_at is not null then return NEW; end if;
    v_payload := jsonb_build_object(
      'name',       NEW.name,
      'legal_form', NEW.legal_form,
      'inn',        NEW.inn
    );
    perform public.log_audit('finance.counterparty.created', 'counterparty', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name',       OLD.name,
      'legal_form', OLD.legal_form,
      'inn',        OLD.inn
    );
    begin
      perform public.log_audit('finance.counterparty.deleted', 'counterparty', OLD.id, v_payload);
    exception
      when foreign_key_violation then
        -- accounts удаляется в этой же транзакции — audit_logs всё
        -- равно каскадно удалится, тихо пропускаем (зеркало venues).
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      perform public.log_audit(
        'finance.counterparty.archived', 'counterparty', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn)
      );
      return NEW;
    end if;
    if OLD.deleted_at is not null and NEW.deleted_at is null then
      perform public.log_audit(
        'finance.counterparty.restored', 'counterparty', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn)
      );
      return NEW;
    end if;

    if OLD.name is distinct from NEW.name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'name', 'old', OLD.name, 'new', NEW.name
      ));
    end if;
    if OLD.legal_form is distinct from NEW.legal_form then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'legal_form', 'old', OLD.legal_form, 'new', NEW.legal_form
      ));
    end if;
    if OLD.inn is distinct from NEW.inn then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'inn', 'old', OLD.inn, 'new', NEW.inn
      ));
    end if;
    if OLD.kpp is distinct from NEW.kpp then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'kpp', 'old', OLD.kpp, 'new', NEW.kpp
      ));
    end if;
    if OLD.ogrn is distinct from NEW.ogrn then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'ogrn', 'old', OLD.ogrn, 'new', NEW.ogrn
      ));
    end if;
    if OLD.contact_person is distinct from NEW.contact_person then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'contact_person', 'old', OLD.contact_person, 'new', NEW.contact_person
      ));
    end if;
    if OLD.phone is distinct from NEW.phone then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'phone', 'old', OLD.phone, 'new', NEW.phone
      ));
    end if;
    if OLD.email is distinct from NEW.email then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'email', 'old', OLD.email, 'new', NEW.email
      ));
    end if;
    if OLD.address is distinct from NEW.address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'address', 'old', OLD.address, 'new', NEW.address
      ));
    end if;
    if OLD.description is distinct from NEW.description then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'description', 'old', OLD.description, 'new', NEW.description
      ));
    end if;
    if OLD.group_id is distinct from NEW.group_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'group_id', 'old', OLD.group_id, 'new', NEW.group_id
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit('finance.counterparty.updated', 'counterparty', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.counterparties_audit_trigger() is
  'Audit-trail для public.counterparties: created/updated/archived/restored/'
  'deleted (hard). archived/restored — переходы deleted_at, deleted — '
  'физический DELETE.';

drop trigger if exists counterparties_audit on public.counterparties;
create trigger counterparties_audit
  after insert or update or delete on public.counterparties
  for each row
  execute function public.counterparties_audit_trigger();
