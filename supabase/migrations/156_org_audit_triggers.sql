-- ============================================================
-- 156_org_audit_triggers.sql
--
-- Audit-trail для блока «Организация»: аккаунты, заведения, юрлица.
-- Пишет в общий audit_logs через log_audit() (035).
--
-- Прецеденты: 153 (staff), 154 (invitations/roles), 155 (finance).
--
-- account_id есть колонкой у venues / legal_entities. У accounts
-- сам ряд И ЕСТЬ account_id (entity_id = NEW.id = account_id).
--
-- Что логируем:
--   accounts:
--     • UPDATE значимых полей (name, logo_url, ai_enabled) → account.updated
--     (INSERT не логируем: новый аккаунт = первое действие юзера в
--      системе, в журнале того аккаунта показывать «вы создали аккаунт»
--      странно, плюс контекста ещё не настроен — get_active_account_id
--      на момент signup'а вернёт null.)
--     (DELETE не логируем: каскад от удаления auth.users.id или ручная
--      административная операция; журнал тоже каскадно удалится.)
--   venues:
--     • INSERT                     → venue.created
--     • UPDATE значимых полей      → venue.updated (diff)
--     • DELETE                     → venue.deleted (hard — soft-delete
--                                    на venues отсутствует)
--   legal_entities:
--     • INSERT                     → legal_entity.created
--     • UPDATE значимых полей      → legal_entity.updated (diff)
--     • UPDATE is_active true→false → legal_entity.archived
--     • UPDATE is_active false→true → legal_entity.restored
--
-- Чего НЕ логируем:
--   • venues.working_hours: jsonb с часами по дням — шумно, редко
--     требует контроля. Можно добавить при запросе.
--   • venues.created_at / accounts.created_at: служебные.
--   • legal_entities.dadata_synced_at: auto-апдейт от интеграции DaData.
--   • legal_entities.updated_at / updated_by / created_*: служебные.
-- ============================================================

-- ── accounts ─────────────────────────────────────────────────

create or replace function public.accounts_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_account_id uuid;
begin
  if TG_OP <> 'UPDATE' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  -- account_id для записи в audit_logs = сам id ряда (account и есть
  -- сущность). Используем log_audit_with_context чтобы не зависеть от
  -- get_active_account_id (может быть null если апдейт идёт через
  -- service_role / admin client).
  v_account_id := NEW.id;

  if OLD.name is distinct from NEW.name then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'name', 'old', OLD.name, 'new', NEW.name
    ));
  end if;
  if OLD.logo_url is distinct from NEW.logo_url then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'logo_url', 'old', OLD.logo_url, 'new', NEW.logo_url
    ));
  end if;
  if OLD.ai_enabled is distinct from NEW.ai_enabled then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'ai_enabled', 'old', OLD.ai_enabled, 'new', NEW.ai_enabled
    ));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    v_payload := jsonb_build_object(
      'name',    NEW.name,
      'changes', v_changes
    );
    perform public.log_audit_with_context(
      'account.updated', 'account', NEW.id, v_payload,
      v_account_id, auth.uid(), null, null
    );
  end if;

  return NEW;
end;
$$;

comment on function public.accounts_audit_trigger() is
  'Audit-trail для public.accounts: только updated (name, logo, ai_enabled). '
  'Create/delete не логируем (signup-once / cascade).';

drop trigger if exists accounts_audit on public.accounts;
create trigger accounts_audit
  after update on public.accounts
  for each row
  execute function public.accounts_audit_trigger();

-- ── venues ───────────────────────────────────────────────────

create or replace function public.venues_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
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
      'name',     NEW.name,
      'type',     NEW.type,
      'address',  NEW.address
    );
    perform public.log_audit_with_context(
      'venue.created', 'venue', NEW.id, v_payload,
      v_account_id, auth.uid(), v_venue_id, null
    );
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    -- Cascade-safe: при DELETE accounts → cascade venues, и INSERT в
    -- audit_logs ссылается на about-to-be-deleted account → FK
    -- violation. `pg_trigger_depth()` не считает internal RI cascade,
    -- так что ловим foreign_key_violation в exception block.
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
        -- account уже удаляется в этой же транзакции — пропускаем,
        -- audit_logs всё равно каскадно удалится.
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
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
  'Audit-trail для public.venues: created / updated (diff) / deleted (hard). '
  'working_hours и created_at не шумят.';

drop trigger if exists venues_audit on public.venues;
create trigger venues_audit
  after insert or update or delete on public.venues
  for each row
  execute function public.venues_audit_trigger();

-- ── legal_entities ───────────────────────────────────────────

create or replace function public.legal_entities_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_account_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_account_id := OLD.account_id;
  else
    v_account_id := NEW.account_id;
  end if;
  if v_account_id is null then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'name',       NEW.name,
      'legal_form', NEW.legal_form,
      'inn',        NEW.inn
    );
    perform public.log_audit_with_context(
      'legal_entity.created', 'legal_entity', NEW.id, v_payload,
      v_account_id, auth.uid(), null, NEW.id
    );
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name',       OLD.name,
      'legal_form', OLD.legal_form,
      'inn',        OLD.inn
    );
    begin
      perform public.log_audit_with_context(
        'legal_entity.deleted', 'legal_entity', OLD.id, v_payload,
        v_account_id, auth.uid(), null, null
      );
    exception
      when foreign_key_violation then
        -- account cascade-delete (см. venues_audit_trigger §DELETE).
        null;
    end;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    -- is_active toggle.
    if OLD.is_active and not NEW.is_active then
      perform public.log_audit_with_context(
        'legal_entity.archived', 'legal_entity', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn),
        v_account_id, auth.uid(), null, NEW.id
      );
      return NEW;
    end if;
    if not OLD.is_active and NEW.is_active then
      perform public.log_audit_with_context(
        'legal_entity.restored', 'legal_entity', NEW.id,
        jsonb_build_object('name', NEW.name, 'inn', NEW.inn),
        v_account_id, auth.uid(), null, NEW.id
      );
      return NEW;
    end if;

    -- Diff значимых полей.
    if OLD.name is distinct from NEW.name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'name', 'old', OLD.name, 'new', NEW.name
      ));
    end if;
    if OLD.short_name is distinct from NEW.short_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'short_name', 'old', OLD.short_name, 'new', NEW.short_name
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
    if OLD.okpo is distinct from NEW.okpo then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'okpo', 'old', OLD.okpo, 'new', NEW.okpo
      ));
    end if;
    if OLD.okved is distinct from NEW.okved then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'okved', 'old', OLD.okved, 'new', NEW.okved
      ));
    end if;
    if OLD.tax_system is distinct from NEW.tax_system then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'tax_system', 'old', OLD.tax_system, 'new', NEW.tax_system
      ));
    end if;
    if OLD.vat_payer is distinct from NEW.vat_payer then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'vat_payer', 'old', OLD.vat_payer, 'new', NEW.vat_payer
      ));
    end if;
    if OLD.legal_address is distinct from NEW.legal_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'legal_address', 'old', OLD.legal_address, 'new', NEW.legal_address
      ));
    end if;
    if OLD.actual_address is distinct from NEW.actual_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'actual_address', 'old', OLD.actual_address, 'new', NEW.actual_address
      ));
    end if;
    if OLD.postal_address is distinct from NEW.postal_address then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'postal_address', 'old', OLD.postal_address, 'new', NEW.postal_address
      ));
    end if;
    if OLD.director_name is distinct from NEW.director_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'director_name', 'old', OLD.director_name, 'new', NEW.director_name
      ));
    end if;
    if OLD.director_position is distinct from NEW.director_position then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'director_position', 'old', OLD.director_position, 'new', NEW.director_position
      ));
    end if;
    if OLD.accountant_name is distinct from NEW.accountant_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'accountant_name', 'old', OLD.accountant_name, 'new', NEW.accountant_name
      ));
    end if;
    if OLD.signature_basis is distinct from NEW.signature_basis then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'signature_basis', 'old', OLD.signature_basis, 'new', NEW.signature_basis
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
    if OLD.website is distinct from NEW.website then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'website', 'old', OLD.website, 'new', NEW.website
      ));
    end if;
    if OLD.default_bank_name is distinct from NEW.default_bank_name then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_bank_name', 'old', OLD.default_bank_name, 'new', NEW.default_bank_name
      ));
    end if;
    if OLD.default_bik is distinct from NEW.default_bik then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_bik', 'old', OLD.default_bik, 'new', NEW.default_bik
      ));
    end if;
    if OLD.default_account_number is distinct from NEW.default_account_number then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_account_number', 'old', OLD.default_account_number, 'new', NEW.default_account_number
      ));
    end if;
    if OLD.default_corr_account is distinct from NEW.default_corr_account then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'default_corr_account', 'old', OLD.default_corr_account, 'new', NEW.default_corr_account
      ));
    end if;

    if jsonb_array_length(v_changes) > 0 then
      v_payload := jsonb_build_object(
        'name',    NEW.name,
        'changes', v_changes
      );
      perform public.log_audit_with_context(
        'legal_entity.updated', 'legal_entity', NEW.id, v_payload,
        v_account_id, auth.uid(), null, NEW.id
      );
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.legal_entities_audit_trigger() is
  'Audit-trail для public.legal_entities: created / updated (diff) / '
  'archived (is_active=false) / restored / deleted. '
  'dadata_synced_at и служебные поля не шумят.';

drop trigger if exists legal_entities_audit on public.legal_entities;
create trigger legal_entities_audit
  after insert or update or delete on public.legal_entities
  for each row
  execute function public.legal_entities_audit_trigger();
