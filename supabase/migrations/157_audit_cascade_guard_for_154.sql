-- ============================================================
-- 157_audit_cascade_guard_for_154.sql
--
-- Патчит DELETE-ветки в audit-триггерах миграции 154 тем же
-- cascade-guard'ом, который добавлен в 156 для venues / legal_entities.
--
-- Проблема (Codex P1 на PR #281):
--   При удалении accounts Postgres каскадом удаляет дочерние ряды
--   (venues → invitations через venue_id, accounts → roles напрямую,
--   roles → role_permissions). В этом cascade-контексте наш DELETE
--   trigger пытается INSERT в audit_logs с account_id ссылкой на
--   about-to-be-deleted account → FK-violation → откат транзакции
--   удаления (= юзер не может удалить аккаунт).
--
-- Фикс: оборачиваем `perform log_audit_with_context()` /
-- `perform log_audit()` в `begin … exception when foreign_key_violation
-- then null end` — если account уже исчез в той же транзакции, тихо
-- пропускаем запись. audit_logs всё равно каскадно удалятся.
--
-- (`pg_trigger_depth()` не подошёл — internal RI cascade-triggers
-- Postgres не увеличивают depth, проверял локально.)
--
-- 156 содержит этот же exception-block inline. Здесь — CREATE OR
-- REPLACE для функций из 154, чтобы не пересоздавать триггеры
-- (они навешаны на тех же таблицах).
-- ============================================================

-- ── invitations_audit_trigger ────────────────────────────────

create or replace function public.invitations_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name  text;
  v_payload    jsonb;
  v_account_id uuid;
  v_user_id    uuid;
  v_venue_id   uuid;
  v_email      text;
  v_action     text;
  v_entity_id  uuid;
begin
  if TG_OP = 'DELETE' then
    v_venue_id  := OLD.venue_id;
    v_email     := OLD.email;
    v_entity_id := OLD.id;
    select name into v_role_name from public.roles where id = OLD.role_id;
    v_payload := jsonb_build_object(
      'email',     OLD.email,
      'role_id',   OLD.role_id,
      'role_name', v_role_name,
      'venue_id',  OLD.venue_id
    );
    v_action := 'invitation.cancelled';
  elsif TG_OP = 'INSERT' then
    v_venue_id  := NEW.venue_id;
    v_email     := NEW.email;
    v_entity_id := NEW.id;
    select name into v_role_name from public.roles where id = NEW.role_id;
    v_payload := jsonb_build_object(
      'email',     NEW.email,
      'role_id',   NEW.role_id,
      'role_name', v_role_name,
      'venue_id',  NEW.venue_id
    );
    v_action := 'invitation.sent';
  elsif TG_OP = 'UPDATE' then
    if not (OLD.status = 'pending' and NEW.status = 'accepted') then
      return NEW;
    end if;
    v_venue_id  := NEW.venue_id;
    v_email     := NEW.email;
    v_entity_id := NEW.id;
    select name into v_role_name from public.roles where id = NEW.role_id;
    v_payload := jsonb_build_object(
      'email',     NEW.email,
      'role_id',   NEW.role_id,
      'role_name', v_role_name,
      'venue_id',  NEW.venue_id
    );
    v_action := 'invitation.accepted';
  else
    return NEW;
  end if;

  select account_id into v_account_id from public.venues where id = v_venue_id;
  if v_account_id is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null and v_action = 'invitation.accepted' then
    select id into v_user_id from auth.users where lower(email) = lower(v_email) limit 1;
  end if;

  begin
    perform public.log_audit_with_context(
      v_action, 'invitation', v_entity_id, v_payload,
      v_account_id, v_user_id, v_venue_id, null
    );
  exception
    when foreign_key_violation then
      -- Cascade-delete (venues → invitations → account-cascade).
      null;
  end;

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

-- ── roles_audit_trigger ──────────────────────────────────────

create or replace function public.roles_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_is_account_scoped boolean;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'DELETE' then
    v_is_account_scoped := OLD.account_id is not null;
  else
    v_is_account_scoped := NEW.account_id is not null;
  end if;
  if not v_is_account_scoped then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object('name', NEW.name, 'code', NEW.code);
    perform public.log_audit('role.created', 'role', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object(
        'old_name', OLD.name, 'new_name', NEW.name, 'code', NEW.code
      );
      perform public.log_audit('role.renamed', 'role', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object('name', OLD.name, 'code', OLD.code);
    begin
      perform public.log_audit('role.deleted', 'role', OLD.id, v_payload);
    exception
      when foreign_key_violation then
        -- Cascade-delete: roles → accounts ON DELETE CASCADE.
        null;
    end;
    return OLD;
  end if;

  return NEW;
end;
$$;

-- ── role_permissions_audit_trigger ───────────────────────────

create or replace function public.role_permissions_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name        text;
  v_role_code        text;
  v_role_account_id  uuid;
  v_perm_code        text;
  v_perm_desc        text;
  v_payload          jsonb;
  v_role_id          uuid;
  v_perm_id          uuid;
  v_granted          boolean;
  v_action           text;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_role_id := NEW.role_id;
    v_perm_id := NEW.permission_id;
    v_granted := NEW.granted;
    v_action  := case when NEW.granted then 'granted' else 'revoked' end;
  elsif TG_OP = 'UPDATE' then
    if OLD.granted is not distinct from NEW.granted then
      return NEW;
    end if;
    v_role_id := NEW.role_id;
    v_perm_id := NEW.permission_id;
    v_granted := NEW.granted;
    v_action  := case when NEW.granted then 'granted' else 'revoked' end;
  else
    v_role_id := OLD.role_id;
    v_perm_id := OLD.permission_id;
    v_granted := OLD.granted;
    v_action  := 'reset_to_default';
  end if;

  select name, code, account_id
    into v_role_name, v_role_code, v_role_account_id
    from public.roles where id = v_role_id;

  if v_role_account_id is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  select code, description into v_perm_code, v_perm_desc
    from public.permissions where id = v_perm_id;

  v_payload := jsonb_build_object(
    'role_name',              v_role_name,
    'role_code',              v_role_code,
    'permission_code',        v_perm_code,
    'permission_description', v_perm_desc,
    'granted',                v_granted,
    'action',                 v_action
  );

  begin
    perform public.log_audit('role.permissions_changed', 'role', v_role_id, v_payload);
  exception
    when foreign_key_violation then
      -- Cascade-delete: role_permissions → roles → accounts CASCADE.
      null;
  end;

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;
