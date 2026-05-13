-- ============================================================
-- 155_finance_audit_triggers.sql
--
-- Audit-trail для блока «Финансы»: транзакции, счета, статьи,
-- контрагенты. Пишет в общий audit_logs через log_audit() (035).
--
-- Прецеденты: 074 (kb_pages), 153 (staff), 154 (invitations/roles).
--
-- account_id у всех finance-таблиц лежит явной колонкой, деривация
-- из venue не нужна. Используем стандартный log_audit() который
-- читает session-context — финансовые мутации идут через
-- authenticated UI, не service_role. Булковые impорты (source=
-- auto_import) сейчас сидят на service_role и в журнал не попадут;
-- это намеренно — иначе журнал затопит транзакциями из интеграций.
--
-- Что логируем:
--   transactions:
--     • INSERT (deleted_at IS NULL)            → finance.transaction.created
--     • UPDATE deleted_at NULL → NOT NULL      → finance.transaction.deleted
--     • UPDATE deleted_at NOT NULL → NULL      → finance.transaction.restored
--     • UPDATE значимых полей                  → finance.transaction.updated
--       (amount, type, bank_account_id, category_id, counterparty_id,
--       to_bank_account_id, to_legal_entity_id, description, date)
--   bank_accounts:
--     • INSERT                                  → finance.bank_account.created
--     • UPDATE deleted_at NULL → NOT NULL       → finance.bank_account.archived
--     • UPDATE deleted_at NOT NULL → NULL       → finance.bank_account.restored
--     • UPDATE non-balance полей                → finance.bank_account.updated
--       (name, type, group_id, bank_name, bik, account_number,
--       card_holder, card_number_last4, is_active, description)
--   finance_categories:
--     • INSERT                                  → finance.category.created
--     • UPDATE is_active true → false          → finance.category.archived
--     • UPDATE is_active false → true          → finance.category.restored
--     • UPDATE name/type/group/color/icon      → finance.category.updated
--   counterparties:
--     • INSERT                                  → finance.counterparty.created
--     • UPDATE deleted_at NULL → NOT NULL       → finance.counterparty.archived
--     • UPDATE deleted_at NOT NULL → NULL       → finance.counterparty.restored
--     • UPDATE name/inn/kpp/phone/email/etc    → finance.counterparty.updated
--
-- Чего НЕ логируем:
--   • bank_accounts.balance: пересчитывается триггером из transactions,
--     не действие пользователя.
--   • finance_categories.sort_order: drag&drop сортировки UI.
--   • Транзакции с source != 'manual' (quickresto / bank_sync / import) —
--     поток автоматических интеграций, не нужен в журнале.
--   • DELETE (hard): финансовые таблицы используют soft-delete; hard
--     DELETE может прийти только из ON DELETE CASCADE при удалении
--     account/venue — мы это не логируем (account-level cleanup).
-- ============================================================

-- ── helper: добавить change в массив, если OLD/NEW различаются ──
-- Inline в каждом тригере чтобы не плодить функций.

-- ── transactions ─────────────────────────────────────────────

create or replace function public.transactions_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
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
  -- Логируем только source='manual'.
  if TG_OP <> 'DELETE' and NEW.source <> 'manual' then
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

    -- Обычный update — собираем diff значимых полей.
    if OLD.amount is distinct from NEW.amount then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'amount', 'old', OLD.amount, 'new', NEW.amount
      ));
    end if;
    if OLD.type is distinct from NEW.type then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'type', 'old', OLD.type, 'new', NEW.type
      ));
    end if;
    if OLD.bank_account_id is distinct from NEW.bank_account_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'bank_account_id', 'old', OLD.bank_account_id, 'new', NEW.bank_account_id
      ));
    end if;
    if OLD.to_bank_account_id is distinct from NEW.to_bank_account_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'to_bank_account_id', 'old', OLD.to_bank_account_id, 'new', NEW.to_bank_account_id
      ));
    end if;
    if OLD.to_legal_entity_id is distinct from NEW.to_legal_entity_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'to_legal_entity_id', 'old', OLD.to_legal_entity_id, 'new', NEW.to_legal_entity_id
      ));
    end if;
    if OLD.category_id is distinct from NEW.category_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'category_id', 'old', OLD.category_id, 'new', NEW.category_id
      ));
    end if;
    if OLD.counterparty_id is distinct from NEW.counterparty_id then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'counterparty_id', 'old', OLD.counterparty_id, 'new', NEW.counterparty_id
      ));
    end if;
    if OLD.description is distinct from NEW.description then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'description', 'old', OLD.description, 'new', NEW.description
      ));
    end if;
    if OLD.date is distinct from NEW.date then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'date', 'old', OLD.date, 'new', NEW.date
      ));
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

comment on function public.transactions_audit_trigger() is
  'Audit-trail для public.transactions: created/updated/deleted/restored. '
  'Auto-import транзакции игнорирует (поток интеграций).';

drop trigger if exists transactions_audit on public.transactions;
create trigger transactions_audit
  after insert or update on public.transactions
  for each row
  execute function public.transactions_audit_trigger();

-- ── bank_accounts ────────────────────────────────────────────

create or replace function public.bank_accounts_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
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
  'Audit-trail для public.bank_accounts: created/updated/archived/restored. '
  'Balance changes (auto-derived из transactions) пропускает.';

drop trigger if exists bank_accounts_audit on public.bank_accounts;
create trigger bank_accounts_audit
  after insert or update on public.bank_accounts
  for each row
  execute function public.bank_accounts_audit_trigger();

-- ── finance_categories ───────────────────────────────────────

create or replace function public.finance_categories_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
begin
  if public.get_active_account_id() is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- Системные категории (is_system) сидируются в default-data — пропускаем.
    if NEW.is_system then return NEW; end if;
    v_payload := jsonb_build_object(
      'name', NEW.name,
      'type', NEW.type
    );
    perform public.log_audit('finance.category.created', 'finance_category', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- is_active toggle = archive/restore.
    if OLD.is_active and not NEW.is_active then
      perform public.log_audit(
        'finance.category.archived', 'finance_category', NEW.id,
        jsonb_build_object('name', NEW.name, 'type', NEW.type)
      );
      return NEW;
    end if;
    if not OLD.is_active and NEW.is_active then
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
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit('finance.category.updated', 'finance_category', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.finance_categories_audit_trigger() is
  'Audit-trail для public.finance_categories: created/updated/archived/restored. '
  'Системные (is_system) и sort_order не шумят.';

drop trigger if exists finance_categories_audit on public.finance_categories;
create trigger finance_categories_audit
  after insert or update on public.finance_categories
  for each row
  execute function public.finance_categories_audit_trigger();

-- ── counterparties ───────────────────────────────────────────

create or replace function public.counterparties_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
begin
  if public.get_active_account_id() is null then
    return NEW;
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
  'Audit-trail для public.counterparties: created/updated/archived/restored.';

drop trigger if exists counterparties_audit on public.counterparties;
create trigger counterparties_audit
  after insert or update on public.counterparties
  for each row
  execute function public.counterparties_audit_trigger();
