-- ============================================================
-- 367_transactions_bulk_update_audit.sql
--
-- 1. Журнал операций (transactions_audit_trigger):
--    - смена заведения (venue_id) теперь попадает в журнал: раньше её не
--      было ни в общей ленте, ни в «Истории изменений» операции;
--    - счёт, статья, контрагент и заведение пишутся названиями, а не id:
--      история показывала «статья: 1cb9…-… → b64b…-…»;
--    - на время массовой правки (GUC app.audit_bulk = '1', выставляет
--      только функция ниже) построчные записи «изменил(а)» не пишутся.
--      Удаление и восстановление по-прежнему пишутся всегда.
--    Тело взято из актуального определения (миграция 291) — условие про
--    выплаты и finance_execution_bindings сохранено. search_path по
--    конвенции: public, pg_catalog (create or replace сбрасывает прежний).
--
-- 2. finance_bulk_update_transactions — массовая смена статьи,
--    контрагента или заведения. По правилу журнала (CLAUDE.md) массовая
--    операция пишет одну строку на команду: finance.transaction.bulk_updated
--    со списком операций в details.ids — по нему событие находит и
--    «История изменений» каждой затронутой операции.
--    SECURITY INVOKER: строки меняет только политика transactions_update
--    (свои / любые), связанные с зарплатой отклоняет их триггер — такие
--    операции пропускаются, не отменяя остальные.
-- ============================================================

begin;

create or replace function public.transactions_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_bank_name text;
  v_to_bank_name text;
  v_category_name text;
  v_counterparty_name text;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  -- Skip integration-sourced транзакции (quickresto / bank_sync / import) —
  -- это поток из автоматических загрузок, не действие пользователя.
  -- Логируем только source='manual' и операции выплат.
  if TG_OP <> 'DELETE' and NEW.source <> 'manual'
     and not exists(select 1 from public.payroll_payments p where p.transaction_id = NEW.id)
     and not exists(select 1 from private.finance_execution_bindings b where b.transaction_id = NEW.id) then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.deleted_at is not null then
      return NEW;  -- импорт сразу как удалённое — отдельно не логируем
    end if;
    select name into v_bank_name from public.bank_accounts where id = NEW.bank_account_id;
    if NEW.to_bank_account_id is not null then
      select name into v_to_bank_name from public.bank_accounts where id = NEW.to_bank_account_id;
    end if;
    if NEW.category_id is not null then
      select name into v_category_name from public.finance_categories where id = NEW.category_id;
    end if;
    if NEW.counterparty_id is not null then
      select name into v_counterparty_name from public.counterparties where id = NEW.counterparty_id;
    end if;
    v_payload := jsonb_build_object(
      'public_id',          NEW.public_id,
      'type',               NEW.type,
      'amount',             NEW.amount,
      'currency',           NEW.currency,
      'bank_account_id',    NEW.bank_account_id,
      'bank_account_name',  v_bank_name,
      'to_bank_account_id', NEW.to_bank_account_id,
      'to_bank_account_name', v_to_bank_name,
      'category_id',        NEW.category_id,
      'category_name',      v_category_name,
      'counterparty_id',    NEW.counterparty_id,
      'counterparty_name',  v_counterparty_name,
      'description',        NEW.description,
      'date',               NEW.date
    );
    perform public.log_audit('finance.transaction.created', 'transaction', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Soft-delete переходы.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_payload := jsonb_build_object(
        'public_id', NEW.public_id,
        'type',      NEW.type,
        'amount',    NEW.amount
      );
      perform public.log_audit('finance.transaction.deleted', 'transaction', NEW.id, v_payload);
      return NEW;
    end if;
    if OLD.deleted_at is not null and NEW.deleted_at is null then
      v_payload := jsonb_build_object(
        'public_id', NEW.public_id,
        'type',      NEW.type,
        'amount',    NEW.amount
      );
      perform public.log_audit('finance.transaction.restored', 'transaction', NEW.id, v_payload);
      return NEW;
    end if;

    -- Массовая правка пишет одно событие на команду сама.
    if current_setting('app.audit_bulk', true) = '1' then
      return NEW;
    end if;

    -- Обычный update — собираем diff значимых полей.
    if OLD.amount is distinct from NEW.amount then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'amount', 'old', OLD.amount, 'new', NEW.amount));
    end if;
    if OLD.type is distinct from NEW.type then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'type', 'old', OLD.type, 'new', NEW.type));
    end if;
    if OLD.bank_account_id is distinct from NEW.bank_account_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'bank_account_id',
        'old', (select name from public.bank_accounts where id = OLD.bank_account_id),
        'new', (select name from public.bank_accounts where id = NEW.bank_account_id)));
    end if;
    if OLD.to_bank_account_id is distinct from NEW.to_bank_account_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'to_bank_account_id',
        'old', (select name from public.bank_accounts where id = OLD.to_bank_account_id),
        'new', (select name from public.bank_accounts where id = NEW.to_bank_account_id)));
    end if;
    if OLD.to_legal_entity_id is distinct from NEW.to_legal_entity_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'to_legal_entity_id',
        'old', (select coalesce(short_name, name) from public.legal_entities where id = OLD.to_legal_entity_id),
        'new', (select coalesce(short_name, name) from public.legal_entities where id = NEW.to_legal_entity_id)));
    end if;
    if OLD.category_id is distinct from NEW.category_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'category_id',
        'old', (select name from public.finance_categories where id = OLD.category_id),
        'new', (select name from public.finance_categories where id = NEW.category_id)));
    end if;
    if OLD.counterparty_id is distinct from NEW.counterparty_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'counterparty_id',
        'old', (select name from public.counterparties where id = OLD.counterparty_id),
        'new', (select name from public.counterparties where id = NEW.counterparty_id)));
    end if;
    if OLD.venue_id is distinct from NEW.venue_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'venue_id',
        'old', (select name from public.venues where id = OLD.venue_id),
        'new', (select name from public.venues where id = NEW.venue_id)));
    end if;
    if OLD.description is distinct from NEW.description then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'description', 'old', OLD.description, 'new', NEW.description));
    end if;
    if OLD.date is distinct from NEW.date then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'date', 'old', OLD.date, 'new', NEW.date));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'public_id', NEW.public_id,
        'changes',   v_changes
      );
      perform public.log_audit('finance.transaction.updated', 'transaction', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

create or replace function public.finance_bulk_update_transactions(
  p_ids   uuid[],
  p_field text,
  p_value uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_uid            uuid := auth.uid();
  v_category_type  text;
  v_value_name     text;
  v_id             uuid;
  v_updated        uuid[] := '{}';
  v_public_ids     bigint[] := '{}';
  v_public_id      bigint;
begin
  if v_uid is null then
    raise exception 'Сессия устарела. Обновите страницу' using errcode = '28000';
  end if;
  if p_field not in ('category_id', 'counterparty_id', 'venue_id') then
    raise exception 'Это поле нельзя менять массово' using errcode = '22023';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('updated', 0, 'skipped', 0);
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'За раз можно изменить не больше 500 операций' using errcode = '22023';
  end if;

  if p_field = 'category_id' and p_value is not null then
    select type::text, name into v_category_type, v_value_name
      from public.finance_categories where id = p_value and archived_at is null;
    if v_category_type is null then
      raise exception 'Статья не найдена или в архиве' using errcode = 'P0002';
    end if;
  elsif p_field = 'counterparty_id' and p_value is not null then
    select name into v_value_name from public.counterparties
     where id = p_value and deleted_at is null;
    if v_value_name is null then
      raise exception 'Контрагент не найден или в архиве' using errcode = 'P0002';
    end if;
  elsif p_field = 'venue_id' and p_value is not null then
    -- Без finance.view_all_venues операцию чужого заведения пользователь
    -- потом не увидел бы — ставить можно только активное.
    if p_value is distinct from public.get_active_venue_id()
       and not public.has_permission('finance.view_all_venues') then
      raise exception 'Можно выбрать только своё заведение' using errcode = '42501';
    end if;
    select name into v_value_name from public.venues where id = p_value;
    if v_value_name is null then
      raise exception 'Заведение не найдено' using errcode = 'P0002';
    end if;
  end if;

  perform set_config('app.audit_bulk', '1', true);

  foreach v_id in array (select array_agg(distinct x) from unnest(p_ids) x) loop
    begin
      v_public_id := null;
      if p_field = 'category_id' then
        update public.transactions
           set category_id = p_value, updated_at = now(), updated_by = v_uid
         where id = v_id and deleted_at is null and type <> 'transfer'
           and (v_category_type is null or type::text = v_category_type)
        returning public_id into v_public_id;
      elsif p_field = 'counterparty_id' then
        update public.transactions
           set counterparty_id = p_value, updated_at = now(), updated_by = v_uid
         where id = v_id and deleted_at is null and type <> 'transfer'
        returning public_id into v_public_id;
      else
        update public.transactions
           set venue_id = p_value, updated_at = now(), updated_by = v_uid
         where id = v_id and deleted_at is null
        returning public_id into v_public_id;
      end if;
      if v_public_id is not null then
        v_updated := v_updated || v_id;
        v_public_ids := v_public_ids || v_public_id;
      end if;
    exception when others then
      -- Связанные операции (выплаты, покупки формы) отклоняет их триггер;
      -- остальные выбранные это не останавливает.
      null;
    end;
  end loop;

  perform set_config('app.audit_bulk', '', true);

  if array_length(v_updated, 1) > 0 then
    perform public.log_audit(
      'finance.transaction.bulk_updated', 'transaction', null,
      jsonb_build_object(
        'field',      p_field,
        'value_name', v_value_name,
        'count',      array_length(v_updated, 1),
        'ids',        to_jsonb(v_updated),
        'public_ids', to_jsonb(v_public_ids)
      ));
  end if;

  return jsonb_build_object(
    'updated', coalesce(array_length(v_updated, 1), 0),
    'skipped', (select count(distinct x) from unnest(p_ids) x) - coalesce(array_length(v_updated, 1), 0)
  );
end;
$$;

comment on function public.finance_bulk_update_transactions(uuid[], text, uuid) is
  'Массовая смена статьи, контрагента или заведения у операций. SECURITY INVOKER: права — политика transactions_update. Одна запись журнала на команду. Миграция 367.';

revoke all on function public.finance_bulk_update_transactions(uuid[], text, uuid) from public, anon;
grant execute on function public.finance_bulk_update_transactions(uuid[], text, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.finance_bulk_update_transactions(uuid[], text, uuid)', 'EXECUTE') then
    raise exception 'finance_bulk_update_transactions доступна anon: применяйте от владельца функции';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_bulk_update_transactions(uuid[], text, uuid)', 'EXECUTE') then
    raise exception 'finance_bulk_update_transactions недоступна authenticated';
  end if;
  -- Триггер аудита должен остаться с фиксированным search_path.
  if not exists (
    select 1 from pg_proc
     where oid = 'public.transactions_audit_trigger'::regproc
       and proconfig @> array['search_path=public, pg_catalog']
  ) then
    raise exception 'transactions_audit_trigger без search_path';
  end if;
end $$;

commit;
