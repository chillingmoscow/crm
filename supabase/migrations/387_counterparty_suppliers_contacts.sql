-- ============================================================
-- 387_counterparty_suppliers_contacts.sql
-- Контрагенты, этап 2 (docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md):
--   * отметка «Поставщик» — руками и сама при привязке к позиции номенклатуры;
--   * условия поставок (все необязательные);
--   * несколько контактов с Telegram — jsonb-массив в строке контрагента.
--     Старые contact_person / phone / email остаются в таблице, приложение
--     их больше не пишет и не читает; сужение — отдельной миграцией.
--   * журнал контрагента видит новые поля.
-- ============================================================

alter table public.counterparties
  add column is_supplier        boolean      not null default false,
  add column payment_delay_days integer,
  add column min_order_amount   numeric(14,2),
  add column order_weekdays     smallint[]   not null default '{}',
  add column delivery_weekdays  smallint[]   not null default '{}',
  add column contacts           jsonb        not null default '[]'::jsonb;

alter table public.counterparties
  add constraint counterparties_payment_delay_days_check
    check (payment_delay_days is null or payment_delay_days between 0 and 365),
  add constraint counterparties_min_order_amount_check
    check (min_order_amount is null or min_order_amount >= 0),
  add constraint counterparties_order_weekdays_check
    check (order_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  add constraint counterparties_delivery_weekdays_check
    check (delivery_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  add constraint counterparties_contacts_check
    check (jsonb_typeof(contacts) = 'array' and jsonb_array_length(contacts) <= 10);

comment on column public.counterparties.is_supplier is
  'Поставщик: ставится руками или сам при привязке к позиции номенклатуры (ingredient_suppliers).';
comment on column public.counterparties.contacts is
  'Контакты: [{name, role, phone, email, telegram}], telegram — ник без @. Заменяет contact_person/phone/email.';

-- Отключаем журнал на время заполнения: это перенос, а не правка людьми.
alter table public.counterparties disable trigger counterparties_audit;

update public.counterparties c
   set is_supplier = true
 where exists (
   select 1 from public.ingredient_suppliers s
    where s.account_id = c.account_id and s.counterparty_id = c.id
 );

update public.counterparties
   set contacts = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
         'name',  coalesce(nullif(btrim(contact_person), ''), 'Контакт'),
         'phone', nullif(btrim(phone), ''),
         'email', nullif(btrim(email), '')
       )))
 where coalesce(btrim(contact_person), '') <> ''
    or coalesce(btrim(phone), '') <> ''
    or coalesce(btrim(email), '') <> '';

alter table public.counterparties enable trigger counterparties_audit;

-- Привязали контрагента поставщиком к позиции — он поставщик.
create or replace function public.ingredient_suppliers_mark_supplier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.counterparties
     set is_supplier = true
   where account_id = NEW.account_id
     and id = NEW.counterparty_id
     and not is_supplier;
  return NEW;
end;
$$;

revoke all on function public.ingredient_suppliers_mark_supplier() from public, anon, authenticated;

create trigger ingredient_suppliers_mark_supplier
  after insert on public.ingredient_suppliers
  for each row
  execute function public.ingredient_suppliers_mark_supplier();

-- «пн, ср» для журнала.
create or replace function public.weekday_names(p_days smallint[])
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select nullif(string_agg(
    (array['пн','вт','ср','чт','пт','сб','вс'])[d], ', ' order by d
  ), '')
  from unnest(coalesce(p_days, '{}'::smallint[])) d
$$;

create or replace function public.counterparties_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

    -- 387: поставщик, условия поставок, контакты.
    if OLD.is_supplier is distinct from NEW.is_supplier then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'is_supplier', 'old', OLD.is_supplier, 'new', NEW.is_supplier
      ));
    end if;
    if OLD.payment_delay_days is distinct from NEW.payment_delay_days then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'payment_delay_days', 'old', OLD.payment_delay_days::text, 'new', NEW.payment_delay_days::text
      ));
    end if;
    if OLD.min_order_amount is distinct from NEW.min_order_amount then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'min_order_amount', 'old', OLD.min_order_amount::text, 'new', NEW.min_order_amount::text
      ));
    end if;
    if OLD.order_weekdays is distinct from NEW.order_weekdays then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'order_weekdays',
        'old', public.weekday_names(OLD.order_weekdays),
        'new', public.weekday_names(NEW.order_weekdays)
      ));
    end if;
    if OLD.delivery_weekdays is distinct from NEW.delivery_weekdays then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'delivery_weekdays',
        'old', public.weekday_names(OLD.delivery_weekdays),
        'new', public.weekday_names(NEW.delivery_weekdays)
      ));
    end if;
    if OLD.contacts is distinct from NEW.contacts then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'contacts',
        'old', (select string_agg(c->>'name', ', ') from jsonb_array_elements(OLD.contacts) c),
        'new', (select string_agg(c->>'name', ', ') from jsonb_array_elements(NEW.contacts) c)
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
$function$;
