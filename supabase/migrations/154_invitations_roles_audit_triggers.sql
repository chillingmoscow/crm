-- ============================================================
-- 154_invitations_roles_audit_triggers.sql
--
-- Audit-trail для оставшихся блоков «Персонал»: приглашения и роли.
-- Пишет в общий audit_logs (миграция 035) через log_audit().
--
-- Прецеденты: миграции 074 (kb_pages_audit), 153 (staff audit).
--
-- Что логируем:
--   invitations:
--     • INSERT       → invitation.sent     (email, role_name, venue_id)
--     • DELETE       → invitation.cancelled
--     • UPDATE status pending → accepted → invitation.accepted
--   roles (только account-scoped, account_id IS NOT NULL):
--     • INSERT       → role.created   (name, code)
--     • UPDATE name  → role.renamed   (old_name → new_name)
--     • DELETE       → role.deleted
--   role_permissions (только account-scoped роли — у roles.account_id IS NOT NULL):
--     • INSERT       → role.permissions_changed (granted: NEW.granted)
--     • UPDATE       → role.permissions_changed (только если granted
--                      реально поменялся)
--     • DELETE       → role.permissions_changed (action: "reset_to_default")
--   Системные дефолты (role.account_id IS NULL) пропускаем — таблица
--   seed'ится миграциями и runtime-изменений не бывает.
--   account_role_permissions удалён в миграции 138 (owner-only system).
--
-- Чего НЕ логируем (намеренно):
--   roles: comment, icon, icon_color (косметика, не security-relevant).
--   invitation.expired: автотранзишен по таймеру, не действие юзера.
-- ============================================================

-- ── invitations ──────────────────────────────────────────────

create or replace function public.invitations_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name text;
  v_payload jsonb;
begin
  -- Системный контекст (seed / cron без сессии) пропускаем — иначе
  -- audit_logs.account_id not-null упадёт.
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    select name into v_role_name from public.roles where id = NEW.role_id;
    v_payload := jsonb_build_object(
      'email',     NEW.email,
      'role_id',   NEW.role_id,
      'role_name', v_role_name,
      'venue_id',  NEW.venue_id
    );
    perform public.log_audit('invitation.sent', 'invitation', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- pending → accepted (юзер принял приглашение). Остальные переходы
    -- — статусные коды накатки, не действия пользователя.
    if OLD.status = 'pending' and NEW.status = 'accepted' then
      select name into v_role_name from public.roles where id = NEW.role_id;
      v_payload := jsonb_build_object(
        'email',     NEW.email,
        'role_id',   NEW.role_id,
        'role_name', v_role_name,
        'venue_id',  NEW.venue_id
      );
      perform public.log_audit('invitation.accepted', 'invitation', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    select name into v_role_name from public.roles where id = OLD.role_id;
    v_payload := jsonb_build_object(
      'email',     OLD.email,
      'role_id',   OLD.role_id,
      'role_name', v_role_name,
      'venue_id',  OLD.venue_id
    );
    perform public.log_audit('invitation.cancelled', 'invitation', OLD.id, v_payload);
    return OLD;
  end if;

  return NEW;
end;
$$;

comment on function public.invitations_audit_trigger() is
  'Audit-trail для invitations: sent / accepted / cancelled в audit_logs.';

drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit
  after insert or update or delete on public.invitations
  for each row
  execute function public.invitations_audit_trigger();

-- ── roles (account-scoped) ───────────────────────────────────

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

  -- Только account-scoped роли логируем. Системные (account_id IS NULL)
  -- меняются миграциями и не должны шуметь в общий журнал.
  if TG_OP = 'DELETE' then
    v_is_account_scoped := OLD.account_id is not null;
  else
    v_is_account_scoped := NEW.account_id is not null;
  end if;
  if not v_is_account_scoped then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'name', NEW.name,
      'code', NEW.code
    );
    perform public.log_audit('role.created', 'role', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object(
        'old_name', OLD.name,
        'new_name', NEW.name,
        'code',     NEW.code
      );
      perform public.log_audit('role.renamed', 'role', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object(
      'name', OLD.name,
      'code', OLD.code
    );
    perform public.log_audit('role.deleted', 'role', OLD.id, v_payload);
    return OLD;
  end if;

  return NEW;
end;
$$;

comment on function public.roles_audit_trigger() is
  'Audit-trail для public.roles (только account-scoped): created / renamed / deleted.';

drop trigger if exists roles_audit on public.roles;
create trigger roles_audit
  after insert or update or delete on public.roles
  for each row
  execute function public.roles_audit_trigger();

-- ── role_permissions (account-scoped only) ───────────────────

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
    -- Только реальные смены granted; updated_at и пр. не шумят.
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

  -- Пропускаем системные роли (account_id IS NULL) — их permission'ы
  -- меняются только seed-миграциями, не пользователями.
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

  perform public.log_audit('role.permissions_changed', 'role', v_role_id, v_payload);

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

comment on function public.role_permissions_audit_trigger() is
  'Audit-trail для granted-изменений permissions account-scoped роли.';

drop trigger if exists role_permissions_audit on public.role_permissions;
create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row
  execute function public.role_permissions_audit_trigger();
