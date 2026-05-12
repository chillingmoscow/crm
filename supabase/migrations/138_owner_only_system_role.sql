-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 138_owner_only_system_role.sql
--
-- До сих пор у нас 6 системных ролей (account_id is null): owner, manager,
-- admin, accountant, hostess, waiter. Все они шарились между аккаунтами,
-- а account-scoped перекрытия жили в public.account_role_permissions.
--
-- После этой миграции:
--   * Системной остаётся только `owner`.
--   * Manager / Admin / Accountant / Хостес / Официант перевезены в кастомные
--     роли каждого существующего аккаунта (с сохранением реальных эффективных
--     прав — мерджа base + account_role_permissions override'ов).
--   * Все UVR и pending-invitations этого аккаунта пересажены с системной
--     роли на её per-account-клон.
--   * public.account_hidden_roles удалена (механика «скрыть системную для
--     аккаунта» больше не нужна — кастомные роли просто DELETE'ятся).
--   * public.account_role_permissions удалена (overrides схлопнуты в базовые
--     role_permissions клонов).
--   * RPC `has_permission`, `get_effective_role_permissions`,
--     `set_effective_role_permission` упрощены: нет больше override-логики.
--   * Новая RPC `seed_default_account_roles(account_id)` создаёт 5
--     преднастроенных ролей с теми же permission-наборами, что были у
--     системных. `complete_owner_onboarding` теперь вызывает её для свежего
--     аккаунта.
--
-- Идемпотентность: миграция использует `if exists` / `do nothing`. Повторный
-- запуск не упадёт, но и не сделает дубликатов (на момент 2-го прогона
-- системных ролей уже нет — переезжать нечего).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Переезд: для каждого аккаунта создаём custom-клоны 5 системных ролей ──

do $$
declare
  v_acc record;
  v_old_role record;
  v_new_role_id uuid;
begin
  for v_acc in select id from public.accounts loop
    for v_old_role in
      select r.id, r.name, r.code, r.comment,
             -- icon / icon_color могут отсутствовать на 002/034 системных ролях
             -- (там insert без них). Берём через coalesce(NULL, NULL) = NULL.
             r.icon, r.icon_color
      from public.roles r
      where r.account_id is null
        and r.code <> 'owner'
    loop
      -- a) custom-клон в этом аккаунте. Если custom_<code> уже существует
      --    (повтор-запуск миграции / ручное создание) — skip.
      if exists (
        select 1 from public.roles
         where account_id = v_acc.id and code = 'custom_' || v_old_role.code
      ) then
        continue;
      end if;

      insert into public.roles (account_id, name, code, comment, icon, icon_color)
      values (
        v_acc.id,
        v_old_role.name,
        'custom_' || v_old_role.code,
        v_old_role.comment,
        v_old_role.icon,
        v_old_role.icon_color
      )
      returning id into v_new_role_id;

      -- b) Permissions: base role_permissions + merge account-scoped override.
      insert into public.role_permissions (role_id, permission_id, granted)
      select v_new_role_id, rp.permission_id,
             coalesce(arp.granted, rp.granted)
      from public.role_permissions rp
      left join public.account_role_permissions arp
        on arp.role_id       = v_old_role.id
       and arp.account_id    = v_acc.id
       and arp.permission_id = rp.permission_id
      where rp.role_id = v_old_role.id;

      -- c) Перенаправляем UVR (любого статуса — active / fired) в venues
      --    этого аккаунта.
      update public.user_venue_roles uvr
      set role_id = v_new_role_id
      where uvr.role_id = v_old_role.id
        and uvr.venue_id in (
          select id from public.venues where account_id = v_acc.id
        );

      -- d) Перенаправляем pending-invitations в venues этого аккаунта.
      update public.invitations inv
      set role_id = v_new_role_id
      where inv.role_id = v_old_role.id
        and inv.venue_id in (
          select id from public.venues where account_id = v_acc.id
        );
    end loop;
  end loop;
end $$;

-- ── 2. Drop account_hidden_roles + helper RPC ────────────────────────────────

drop function if exists public.hide_system_role(uuid);
drop table if exists public.account_hidden_roles cascade;

-- ── 3. Drop account_role_permissions (overrides уже схлопнуты в шаге 1) ─────

drop table if exists public.account_role_permissions cascade;

-- ── 4. Удаляем не-owner системные роли. role_permissions / UVR / invitations
--      уже мигрированы (UVR / invitations используют ON DELETE RESTRICT,
--      поэтому если что-то не мигрировалось — миграция упадёт раньше, чем
--      созадст inconsistent state). ────────────────────────────────────────

delete from public.roles
 where account_id is null
   and code <> 'owner';

-- ── 5. Упрощаем permission RPC: убираем override-логику ─────────────────────

create or replace function public.has_permission(permission_code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.user_venue_roles uvr
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions p on p.id = rp.permission_id
    where uvr.user_id  = auth.uid()
      and uvr.venue_id = public.get_active_venue_id()
      and uvr.status   = 'active'
      and p.code       = permission_code
      and rp.granted   = true
  );
$$;

create or replace function public.get_effective_role_permissions(p_role_ids uuid[] default null)
returns table (role_id uuid, permission_id uuid, granted boolean)
language sql stable security definer set search_path = public
as $$
  select rp.role_id, rp.permission_id, rp.granted
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  where (p_role_ids is null or rp.role_id = any(p_role_ids))
    and (
      r.account_id is null
      or r.account_id = public.get_active_account_id()
    );
$$;

create or replace function public.set_effective_role_permission(
  p_role_id       uuid,
  p_permission_id uuid,
  p_granted       boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id      uuid;
  v_role_account_id uuid;
  v_role_code       text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_permission('platform.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_account_id := public.get_active_account_id();
  if v_account_id is null then
    raise exception 'Active account is not set';
  end if;

  select r.account_id, r.code into v_role_account_id, v_role_code
  from public.roles r
  where r.id = p_role_id;
  if not found then raise exception 'Role not found'; end if;

  if v_role_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;
  if v_role_account_id is null then
    -- Не должно быть достижимо после этой миграции (системная роль одна —
    -- owner, и она уже отрезана выше). Защитный гард на случай ручных правок.
    raise exception 'Системные роли больше не редактируются — это owner';
  end if;
  if v_role_account_id <> v_account_id then
    raise exception 'Role is outside active account';
  end if;

  insert into public.role_permissions (role_id, permission_id, granted)
  values (p_role_id, p_permission_id, p_granted)
  on conflict (role_id, permission_id)
  do update set granted = excluded.granted;
end;
$$;

-- ── 6. seed_default_account_roles — preset для новых аккаунтов ──────────────
--
-- Создаёт 5 преднастроенных ролей с зашитыми permission-кодами (те же
-- наборы, что были в системных ролях миграции 034). Идемпотентна: если в
-- аккаунте уже есть кастомные роли — выходит без изменений.

create or replace function public.seed_default_account_roles(p_account_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_manager_id    uuid;
  v_admin_id      uuid;
  v_accountant_id uuid;
  v_hostess_id    uuid;
  v_waiter_id     uuid;
begin
  -- Если уже есть кастомки — пропускаем (повторный вызов / миграция уже
  -- залила, как у существующих аккаунтов).
  if exists (
    select 1 from public.roles
    where account_id = p_account_id
  ) then
    return;
  end if;

  -- Управляющий
  insert into public.roles (account_id, name, code)
  values (p_account_id, 'Управляющий', 'custom_manager')
  returning id into v_manager_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_manager_id, id, true from public.permissions
  where code in (
    'people.view_staff', 'people.view_staff_details',
    'people.invite_staff', 'people.edit_staff',
    'people.view_roles',
    'org.view_account', 'org.view_venues',
    'finance.view_dashboard', 'finance.view_transactions',
    'finance.create_transaction', 'finance.update_transaction',
    'finance.view_bank_accounts',
    'finance.view_categories', 'finance.view_counterparties',
    'finance.upload_attachments', 'finance.view_attachments',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
    'crm.view_loyalty',
    'settings.manage_notifications', 'settings.use_dadata'
  );

  -- Администратор
  insert into public.roles (account_id, name, code)
  values (p_account_id, 'Администратор', 'custom_admin')
  returning id into v_admin_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_admin_id, id, true from public.permissions
  where code in (
    'people.view_staff', 'people.view_staff_details',
    'people.invite_staff', 'people.edit_staff', 'people.terminate_staff',
    'people.view_roles', 'people.manage_roles',
    'org.view_account', 'org.view_legal_entities',
    'org.view_venues', 'org.manage_venues',
    'org.view_audit',
    'finance.view_dashboard', 'finance.view_transactions',
    'finance.create_transaction', 'finance.update_transaction',
    'finance.update_any_transaction', 'finance.delete_transaction',
    'finance.view_bank_accounts', 'finance.manage_bank_accounts',
    'finance.view_categories', 'finance.manage_categories',
    'finance.view_counterparties', 'finance.manage_counterparties',
    'finance.upload_attachments', 'finance.view_attachments',
    'finance.delete_attachments', 'finance.export',
    'finance.view_all_venues', 'finance.view_all_legal_entities',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
    'crm.view_loyalty', 'crm.manage_loyalty',
    'settings.manage_integrations', 'settings.manage_notifications',
    'settings.use_dadata'
  );

  -- Бухгалтер
  insert into public.roles (account_id, name, code)
  values (p_account_id, 'Бухгалтер', 'custom_accountant')
  returning id into v_accountant_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_accountant_id, id, true from public.permissions
  where code in (
    'people.view_staff', 'people.view_staff_details',
    'org.view_account',
    'org.view_legal_entities', 'org.manage_legal_entities',
    'org.view_venues', 'org.view_audit',
    'finance.view_dashboard', 'finance.view_transactions',
    'finance.create_transaction', 'finance.update_transaction',
    'finance.update_any_transaction', 'finance.delete_transaction',
    'finance.view_bank_accounts', 'finance.manage_bank_accounts',
    'finance.view_categories', 'finance.manage_categories',
    'finance.view_counterparties', 'finance.manage_counterparties',
    'finance.upload_attachments', 'finance.view_attachments',
    'finance.delete_attachments', 'finance.export',
    'finance.view_all_venues', 'finance.view_all_legal_entities',
    'settings.use_dadata'
  );

  -- Хостес
  insert into public.roles (account_id, name, code)
  values (p_account_id, 'Хостес', 'custom_hostess')
  returning id into v_hostess_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_hostess_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation'
  );

  -- Официант
  insert into public.roles (account_id, name, code)
  values (p_account_id, 'Официант', 'custom_waiter')
  returning id into v_waiter_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_waiter_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'crm.view_guests',
    'crm.view_reservations', 'crm.manage_reservations'
  );
end;
$$;

revoke all on function public.seed_default_account_roles(uuid) from public;
grant execute on function public.seed_default_account_roles(uuid) to service_role, authenticated;

-- ── 7. Обновляем complete_owner_onboarding: после создания аккаунта сидим
--      preset-роли. ─────────────────────────────────────────────────────────

drop function if exists public.complete_owner_onboarding(
  text, text, text, public.legal_form_enum, text,
  text, public.venue_type, text, text, text,
  text, text, jsonb
);

create or replace function public.complete_owner_onboarding(
  p_account_name  text,
  p_account_logo  text,
  p_legal_name    text,
  p_legal_form    public.legal_form_enum,
  p_legal_inn     text,
  p_venue_name    text,
  p_venue_type    public.venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_venue_website text     default '',
  p_currency      text     default 'RUB',
  p_timezone      text     default 'Europe/Moscow',
  p_working_hours jsonb    default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id        uuid;
  v_legal_entity_id   uuid;
  v_venue_id          uuid;
  v_owner_role_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- 1. Account (один на owner — берём существующий, если есть).
  select id into v_account_id
  from public.accounts
  where owner_id = auth.uid()
  limit 1;

  if v_account_id is null then
    insert into public.accounts (name, logo_url, owner_id)
    values (p_account_name, p_account_logo, auth.uid())
    returning id into v_account_id;
  end if;

  -- 2. Legal entity (первый существующий или создаём).
  select id into v_legal_entity_id
  from public.legal_entities
  where account_id = v_account_id
  order by created_at asc
  limit 1;

  if v_legal_entity_id is null then
    insert into public.legal_entities (
      account_id, name, legal_form, inn, created_by
    ) values (
      v_account_id,
      p_legal_name,
      p_legal_form,
      nullif(trim(p_legal_inn), ''),
      auth.uid()
    )
    returning id into v_legal_entity_id;
  end if;

  -- 3. Venue
  insert into public.venues (
    account_id, legal_entity_id, name, type, address, phone, website,
    currency, timezone, working_hours
  ) values (
    v_account_id, v_legal_entity_id,
    p_venue_name, p_venue_type, p_venue_address, p_venue_phone, p_venue_website,
    p_currency, p_timezone, p_working_hours
  )
  returning id into v_venue_id;

  -- 4. Owner UVR
  select id into v_owner_role_id from public.roles
   where code = 'owner' and account_id is null;
  insert into public.user_venue_roles (user_id, venue_id, role_id)
  values (auth.uid(), v_venue_id, v_owner_role_id);

  -- 5. Active venue
  update public.profiles set active_venue_id = v_venue_id where id = auth.uid();

  -- 6. Преднастроенные кастомные роли (Управляющий/Администратор/Бухгалтер/
  --    Хостес/Официант). Идемпотентно: если уже создались — функция выходит
  --    без изменений.
  perform public.seed_default_account_roles(v_account_id);

  return jsonb_build_object(
    'account_id', v_account_id,
    'venue_id',   v_venue_id
  );
end;
$$;
