-- ============================================================
-- 154_invitations_roles_audit_triggers.sql
--
-- Audit-trail для оставшихся блоков «Персонал»: приглашения и роли.
-- Пишет в общий audit_logs (миграция 035) через log_audit() или
-- helper log_audit_with_context() для service-role путей.
--
-- Прецеденты: миграции 074 (kb_pages_audit), 153 (staff audit).
--
-- ── Service-role контекст (важно) ─────────────────────────────
-- acceptInvitation (src/app/invite/accept/actions.ts) запускается
-- под createAdminClient() = service_role. В этом контексте auth.uid()
-- и get_active_account_id() возвращают NULL, и стандартный guard
-- из 153 («skip if null») съел бы invitation.accepted и сопутствующий
-- staff.hired (UVR upsert тоже идёт через admin client).
--
-- Поэтому для invitations и UVR деривируем account_id из venue_id
-- через JOIN на venues. Для roles / role_permissions guard оставляем —
-- эти таблицы service_role'ом в runtime не модифицируются.
--
-- Заодно патчим миграцию 153 (staff_uvr_audit_trigger) тем же
-- подходом — CREATE OR REPLACE FUNCTION идемпотентно перепишет тело,
-- триггер уже навешен.
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
--   role_permissions (только account-scoped роли):
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

-- ── Helper: log_audit с explicit account_id ──────────────────
-- log_audit() из 035 берёт account_id из get_active_account_id().
-- Для service-role путей этот вызов даёт NULL → not-null constraint
-- на audit_logs.account_id ронял бы триггер. Helper принимает явный
-- account_id (из venue_id derivation) и опциональный actor user_id.

create or replace function public.log_audit_with_context(
  p_action_code     text,
  p_entity_type     text,
  p_entity_id       uuid,
  p_details         jsonb,
  p_account_id      uuid,
  p_user_id         uuid default null,
  p_venue_id        uuid default null,
  p_legal_entity_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null then
    -- Без аккаунта писать некуда — not-null FK на accounts. Тихо выходим.
    return;
  end if;
  insert into public.audit_logs (
    account_id, legal_entity_id, venue_id, user_id,
    action_code, entity_type, entity_id, details
  ) values (
    p_account_id,
    coalesce(p_legal_entity_id, public.get_active_legal_entity_id()),
    coalesce(p_venue_id,        public.get_active_venue_id()),
    coalesce(p_user_id,         auth.uid()),
    p_action_code, p_entity_type, p_entity_id, p_details
  );
end;
$$;

comment on function public.log_audit_with_context(text, text, uuid, jsonb, uuid, uuid, uuid, uuid) is
  'Запись в audit_logs с явным account_id и опциональными user/venue/legal_entity. '
  'Нужен для service-role путей (acceptInvitation), где auth.uid()=NULL и '
  'get_active_account_id()=NULL. Для обычных authenticated мутаций используется log_audit().';

-- ── invitations ──────────────────────────────────────────────
--
-- Сценарии исполнения:
--   • sent / cancelled — действие админа через authenticated client,
--     session-контекст работает.
--   • accepted — service_role (admin client), session NULL.
--
-- Поэтому account_id всегда деривируем из venue_id (через venues),
-- а actor (user_id) — coalesce(auth.uid(), email lookup в auth.users).

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
    -- Логируем только pending → accepted. Остальные UPDATE'ы — служебные.
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

  -- account_id из venue (работает и в service-role контексте).
  select account_id into v_account_id from public.venues where id = v_venue_id;
  if v_account_id is null then
    -- venue удалили либо данные битые — write нечего, выходим тихо.
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  -- actor: для sent/cancelled берём auth.uid() (authenticated path);
  -- для accepted он будет NULL под admin-client — fallback на лookup
  -- по email в auth.users, чтобы в журнале actor'ом был сам принявший.
  v_user_id := auth.uid();
  if v_user_id is null and v_action = 'invitation.accepted' then
    select id into v_user_id from auth.users where lower(email) = lower(v_email) limit 1;
  end if;

  perform public.log_audit_with_context(
    v_action, 'invitation', v_entity_id, v_payload,
    v_account_id, v_user_id, v_venue_id, null
  );

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

comment on function public.invitations_audit_trigger() is
  'Audit-trail для invitations: sent / accepted / cancelled в audit_logs.';

drop trigger if exists invitations_audit on public.invitations;
create trigger invitations_audit
  after insert or update or delete on public.invitations
  for each row
  execute function public.invitations_audit_trigger();

-- ── PATCH 153: staff_uvr_audit с venue-derived context ───────
--
-- UVR upsert при acceptInvitation идёт через admin client (см. выше),
-- session NULL → guard миграции 153 съедает staff.hired. Перевыпускаем
-- функцию того же триггера: account_id всегда из venue_id, actor =
-- auth.uid() или, для INSERT, fallback на NEW.user_id (сам новичок).
--
-- Триггер уже навешен на user_venue_roles (153 §end-of-file) — здесь
-- только CREATE OR REPLACE FUNCTION, без drop/create trigger.

create or replace function public.staff_uvr_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role_name  text;
  v_new_role_name  text;
  v_payload        jsonb;
  v_account_id     uuid;
  v_user_id        uuid;
  v_venue_id       uuid;
begin
  if TG_OP = 'INSERT' then
    v_venue_id := NEW.venue_id;
  else
    v_venue_id := NEW.venue_id; -- UPDATE использует NEW; DELETE триггер
                                -- на этой функции не навешан (153 — INSERT|UPDATE).
  end if;

  select account_id into v_account_id from public.venues where id = v_venue_id;
  if v_account_id is null then
    return NEW;
  end if;

  -- actor: authenticated path → auth.uid(); admin-client INSERT при
  -- accept'е → NEW.user_id (новичок принял сам). Для UPDATE
  -- (status/role-change) admin-путей нет в текущем коде — оставляем
  -- auth.uid() без fallback'а.
  v_user_id := auth.uid();
  if v_user_id is null and TG_OP = 'INSERT' then
    v_user_id := NEW.user_id;
  end if;

  if TG_OP = 'INSERT' then
    select name into v_new_role_name from public.roles where id = NEW.role_id;
    if NEW.status = 'active' then
      v_payload := jsonb_build_object(
        'uvr_id',    NEW.id,
        'role_id',   NEW.role_id,
        'role_name', v_new_role_name,
        'venue_id',  NEW.venue_id
      );
      perform public.log_audit_with_context(
        'staff.hired', 'staff', NEW.user_id, v_payload,
        v_account_id, v_user_id, NEW.venue_id, null
      );
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
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
      perform public.log_audit_with_context(
        'staff.fired', 'staff', NEW.user_id, v_payload,
        v_account_id, v_user_id, NEW.venue_id, null
      );
      return NEW;
    end if;

    if OLD.status = 'fired' and NEW.status = 'active' then
      v_payload := jsonb_build_object(
        'uvr_id',           NEW.id,
        'venue_id',         NEW.venue_id,
        'previous_fired_at', OLD.fired_at,
        'previous_reason',  OLD.fired_reason
      );
      perform public.log_audit_with_context(
        'staff.restored', 'staff', NEW.user_id, v_payload,
        v_account_id, v_user_id, NEW.venue_id, null
      );
      return NEW;
    end if;

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
      perform public.log_audit_with_context(
        'staff.role_changed', 'staff', NEW.user_id, v_payload,
        v_account_id, v_user_id, NEW.venue_id, null
      );
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.staff_uvr_audit_trigger() is
  'Audit-trail для user_venue_roles. Перевыпуск из миграции 154: '
  'account_id деривируется из venue, actor имеет fallback на NEW.user_id '
  'для admin-client INSERT (accept invitation flow).';

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
