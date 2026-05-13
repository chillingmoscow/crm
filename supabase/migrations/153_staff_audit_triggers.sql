-- ============================================================
-- 153_staff_audit_triggers.sql
-- Audit-trail для сотрудника. Пишет в общий audit_logs (миграция 035)
-- через log_audit(). entity_type='staff', entity_id = profile.id —
-- одна сущность «сотрудник» независимо от того, в скольких venue
-- у него есть user_venue_roles-строка.
--
-- Прецедент: kb_pages_audit_trigger (миграция 074).
--
-- Что логируем:
--   user_venue_roles:
--     • INSERT (status active по умолчанию) → staff.hired
--     • UPDATE status active → fired         → staff.fired
--     • UPDATE status fired → active         → staff.restored
--     • UPDATE role_id (status=active)       → staff.role_changed
--   profiles (только HR-важные поля):
--     • UPDATE phone | telegram_id | birth_date → staff.profile_updated
--   staff_account_details:
--     • INSERT с непустыми полями             → staff.account_details_updated
--     • UPDATE любого из контентных полей     → staff.account_details_updated
--
-- Чего НЕ логируем (намеренно):
--   • profiles: first_name, last_name, gender, address, avatar_url,
--     photo_url — шумно, к HR не относится.
--   • UVR: terminal_pin (POS-настройка), invited_by (не меняется).
--   • staff_account_details: created_at/updated_at/created_by/updated_by
--     (служебные).
-- ============================================================

-- ── user_venue_roles ─────────────────────────────────────────

create or replace function public.staff_uvr_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role_name text;
  v_new_role_name text;
  v_payload jsonb;
begin
  -- Системные операции (seed / cron / прямой SQL без сессии) не имеют
  -- активного аккаунта — пропускаем запись, иначе audit_logs.account_id
  -- not-null constraint упадёт.
  if public.get_active_account_id() is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- Свежий найм. Если статус сразу fired (теоретически возможно
    -- при импорте) — это не «hire», логируем как fired.
    select name into v_new_role_name from public.roles where id = NEW.role_id;
    if NEW.status = 'active' then
      v_payload := jsonb_build_object(
        'uvr_id',    NEW.id,
        'role_id',   NEW.role_id,
        'role_name', v_new_role_name,
        'venue_id',  NEW.venue_id
      );
      perform public.log_audit('staff.hired', 'staff', NEW.user_id, v_payload);
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Active → fired.
    if OLD.status = 'active' and NEW.status = 'fired' then
      select name into v_new_role_name from public.roles where id = NEW.role_id;
      v_payload := jsonb_build_object(
        'uvr_id',    NEW.id,
        'role_id',   NEW.role_id,
        'role_name', v_new_role_name,
        'venue_id',  NEW.venue_id,
        'fired_at',  NEW.fired_at,
        'reason',    NEW.fired_reason
      );
      perform public.log_audit('staff.fired', 'staff', NEW.user_id, v_payload);
      return NEW;
    end if;

    -- Fired → active. Сохраняем previous_reason/previous_fired_at
    -- в payload даже если restoreStaff обнуляет колонки в UVR.
    -- Это и есть основной мотив миграции — UI на табе «Журнал»
    -- сможет показать, почему сотрудник был уволен в прошлый раз.
    if OLD.status = 'fired' and NEW.status = 'active' then
      v_payload := jsonb_build_object(
        'uvr_id',           NEW.id,
        'venue_id',         NEW.venue_id,
        'previous_fired_at', OLD.fired_at,
        'previous_reason',  OLD.fired_reason
      );
      perform public.log_audit('staff.restored', 'staff', NEW.user_id, v_payload);
      return NEW;
    end if;

    -- Role change на активной строке. Не логируем при fired (там
    -- роль не должна меняться по логике приложения, но если кто-то
    -- руками апдейтит — это не «перевод»).
    if NEW.status = 'active' and OLD.role_id is distinct from NEW.role_id then
      select name into v_old_role_name from public.roles where id = OLD.role_id;
      select name into v_new_role_name from public.roles where id = NEW.role_id;
      v_payload := jsonb_build_object(
        'uvr_id',        NEW.id,
        'venue_id',      NEW.venue_id,
        'old_role_id',   OLD.role_id,
        'new_role_id',   NEW.role_id,
        'old_role_name', v_old_role_name,
        'new_role_name', v_new_role_name
      );
      perform public.log_audit('staff.role_changed', 'staff', NEW.user_id, v_payload);
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.staff_uvr_audit_trigger() is
  'Audit-trail для user_venue_roles. Пишет staff.hired/fired/restored/role_changed в audit_logs.';

drop trigger if exists staff_uvr_audit on public.user_venue_roles;
create trigger staff_uvr_audit
  after insert or update on public.user_venue_roles
  for each row
  execute function public.staff_uvr_audit_trigger();

-- ── profiles ─────────────────────────────────────────────────

create or replace function public.staff_profile_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '[]'::jsonb;
begin
  if public.get_active_account_id() is null then
    return NEW;
  end if;
  -- Триггер реагирует только на HR-важные поля. Прочие изменения
  -- profile (имя/аватар/гендер/адрес) намеренно не шумят журнал.
  if OLD.phone is distinct from NEW.phone then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'phone', 'old', OLD.phone, 'new', NEW.phone
    ));
  end if;
  if OLD.telegram_id is distinct from NEW.telegram_id then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'telegram_id', 'old', OLD.telegram_id, 'new', NEW.telegram_id
    ));
  end if;
  if OLD.birth_date is distinct from NEW.birth_date then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'birth_date', 'old', OLD.birth_date, 'new', NEW.birth_date
    ));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    perform public.log_audit(
      'staff.profile_updated',
      'staff',
      NEW.id,
      jsonb_build_object('changes', v_changes)
    );
  end if;

  return NEW;
end;
$$;

comment on function public.staff_profile_audit_trigger() is
  'Audit-trail для HR-важных полей profiles (phone, telegram_id, birth_date).';

drop trigger if exists staff_profile_audit on public.profiles;
create trigger staff_profile_audit
  after update on public.profiles
  for each row
  execute function public.staff_profile_audit_trigger();

-- ── staff_account_details ────────────────────────────────────

create or replace function public.staff_account_details_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb := '[]'::jsonb;
begin
  if public.get_active_account_id() is null then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    -- При создании пустого row (свежий сотрудник без HR-данных)
    -- ничего не пишем — это не действие пользователя.
    if NEW.employment_date is not null then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'employment_date', 'old', null, 'new', NEW.employment_date
      ));
    end if;
    if NEW.medical_book_number is not null then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'medical_book_number', 'old', null, 'new', NEW.medical_book_number
      ));
    end if;
    if NEW.medical_book_date is not null then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'medical_book_date', 'old', null, 'new', NEW.medical_book_date
      ));
    end if;
    if coalesce(array_length(NEW.passport_photos, 1), 0) > 0 then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'passport_photos',
        'old',   to_jsonb('{}'::text[]),
        'new',   to_jsonb(NEW.passport_photos)
      ));
    end if;
    if NEW.comment is not null and NEW.comment <> '' then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'comment', 'old', null, 'new', NEW.comment
      ));
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.employment_date is distinct from NEW.employment_date then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'employment_date', 'old', OLD.employment_date, 'new', NEW.employment_date
      ));
    end if;
    if OLD.medical_book_number is distinct from NEW.medical_book_number then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'medical_book_number', 'old', OLD.medical_book_number, 'new', NEW.medical_book_number
      ));
    end if;
    if OLD.medical_book_date is distinct from NEW.medical_book_date then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'medical_book_date', 'old', OLD.medical_book_date, 'new', NEW.medical_book_date
      ));
    end if;
    if OLD.passport_photos is distinct from NEW.passport_photos then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'passport_photos',
        'old',   to_jsonb(OLD.passport_photos),
        'new',   to_jsonb(NEW.passport_photos)
      ));
    end if;
    if OLD.comment is distinct from NEW.comment then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', 'comment', 'old', OLD.comment, 'new', NEW.comment
      ));
    end if;
  end if;

  if jsonb_array_length(v_changes) > 0 then
    perform public.log_audit(
      'staff.account_details_updated',
      'staff',
      NEW.user_id,
      jsonb_build_object('changes', v_changes)
    );
  end if;

  return NEW;
end;
$$;

comment on function public.staff_account_details_audit_trigger() is
  'Audit-trail для HR-данных сотрудника (employment_date, медкнижка, паспорт, comment).';

drop trigger if exists staff_account_details_audit on public.staff_account_details;
create trigger staff_account_details_audit
  after insert or update on public.staff_account_details
  for each row
  execute function public.staff_account_details_audit_trigger();
