-- ─────────────────────────────────────────────────────────────────────────────
-- 167_seed_default_venue_roles.sql
--
-- Stage A: новая RPC `seed_default_venue_roles(p_venue_id)` — venue-scoped
-- аналог `seed_default_account_roles` (миграция 138). Создаёт preset из
-- 5 кастомных ролей (Управляющий, Администратор, Бухгалтер, Хостес,
-- Официант) с дефолтными правами **в заданном venue**.
--
-- Permission-наборы 1-в-1 с миграцией 138 — пока договорённость такая:
-- venue-scoped роли при создании получают те же дефолты что и старые
-- account-scoped. Дальше пользователь конфигурирует независимо.
--
-- Идемпотентна: если в venue уже есть кастомные роли (venue_id = p_venue_id),
-- выходит без изменений.
--
-- Используется новым онбордингом и при создании нового venue (вызов будет
-- добавлен в stage B; в stage A функция просто доступна).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.seed_default_venue_roles(p_venue_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id    uuid;
  v_manager_id    uuid;
  v_admin_id      uuid;
  v_accountant_id uuid;
  v_hostess_id    uuid;
  v_waiter_id     uuid;
begin
  -- Auth guard. Codex P1 на #300: без проверки любой authenticated
  -- юзер может seed-нуть роли в чужой venue, зная UUID.
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Venue + его account.
  select account_id into v_account_id
    from public.venues where id = p_venue_id;
  if v_account_id is null then
    raise exception 'Venue not found';
  end if;

  -- Caller должен быть active member любого venue этого аккаунта.
  if not exists (
    select 1
    from public.user_venue_roles uvr
    join public.venues v on v.id = uvr.venue_id
    where uvr.user_id = auth.uid()
      and uvr.status = 'active'
      and v.account_id = v_account_id
  ) then
    raise exception 'Caller is not a member of this account';
  end if;

  -- Guard: если в venue уже есть кастомные роли — пропускаем.
  if exists (
    select 1 from public.roles where venue_id = p_venue_id
  ) then
    return;
  end if;

  -- Управляющий
  -- account_id выставляем (= venues.account_id) ради backward-compat
  -- с roles_select RLS, которая до Stage D считает `account_id IS NULL`
  -- маркером системной роли. После Stage D account_id уйдёт совсем.
  insert into public.roles (venue_id, account_id, name, code)
  values (p_venue_id, v_account_id, 'Управляющий', 'custom_manager')
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
    'inventory.view_products', 'inventory.manage_products',
    'inventory.view_stores', 'inventory.manage_stores',
    'inventory.view_documents', 'inventory.manage_documents',
    'inventory.fill_assigned_documents', 'inventory.view_results',
    'inventory.sync_quickresto',
    'inventory.comment_results', 'inventory.adjust_results',
    'inventory.finalize_results', 'inventory.use_ai_suggestions',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
    'crm.view_loyalty',
    'settings.manage_notifications', 'settings.use_dadata'
  );

  -- Администратор
  insert into public.roles (venue_id, account_id, name, code)
  values (p_venue_id, v_account_id, 'Администратор', 'custom_admin')
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
    'inventory.view_products', 'inventory.manage_products',
    'inventory.view_stores', 'inventory.manage_stores',
    'inventory.view_documents', 'inventory.manage_documents',
    'inventory.fill_assigned_documents', 'inventory.view_results',
    'inventory.sync_quickresto',
    'inventory.comment_results', 'inventory.adjust_results',
    'inventory.finalize_results', 'inventory.use_ai_suggestions',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
    'crm.view_loyalty', 'crm.manage_loyalty',
    'settings.manage_integrations', 'settings.manage_notifications',
    'settings.use_dadata'
  );

  -- Бухгалтер
  insert into public.roles (venue_id, account_id, name, code)
  values (p_venue_id, v_account_id, 'Бухгалтер', 'custom_accountant')
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
  insert into public.roles (venue_id, account_id, name, code)
  values (p_venue_id, v_account_id, 'Хостес', 'custom_hostess')
  returning id into v_hostess_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_hostess_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'inventory.fill_assigned_documents',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation'
  );

  -- Официант
  insert into public.roles (venue_id, account_id, name, code)
  values (p_venue_id, v_account_id, 'Официант', 'custom_waiter')
  returning id into v_waiter_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_waiter_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'inventory.fill_assigned_documents',
    'crm.view_guests',
    'crm.view_reservations', 'crm.manage_reservations'
  );
end;
$$;

revoke all on function public.seed_default_venue_roles(uuid) from public;
grant execute on function public.seed_default_venue_roles(uuid) to service_role, authenticated;

comment on function public.seed_default_venue_roles(uuid) is
  'Создаёт 5 preset кастомных ролей (Менеджер, Админ, Бухгалтер, Хостес, '
  'Официант) с дефолтными правами в указанном venue. Идемпотентна. '
  'Используется в stage B при создании venue. Преcет идентичен '
  'seed_default_account_roles из миграции 138.';
