-- ============================================================
-- 034_new_permissions_and_accountant_role.sql
--
-- Replace the legacy `platform.*` permissions with the block-namespaced
-- catalogue (`people.*`, `org.*`, `finance.*`, `crm.*`, `settings.*`).
-- See docs/MERGE_PLAN.md §4.
--
-- Greenfield migration: prod has only test data, no real customer
-- account_role_permissions overrides to preserve. We DELETE all
-- permissions (cascading role_permissions and account_role_permissions
-- via ON DELETE CASCADE) and reseed everything from scratch.
--
-- Sections:
--   1. Drop policies that reference platform.* (recreated in §7)
--   2. Wipe permissions
--   3. Insert 48 new permission codes
--   4. Add 6th system role: accountant
--   5. Insert default role_permissions matrix (MERGE_PLAN §4.3)
--   6. Update set_effective_role_permission to use new code
--   7. Recreate policies with new permission codes
--   8. Enable RLS on legal_entities (table from 032) + add policies
-- ============================================================

-- ============================================================
-- 1. Drop existing policies that reference platform.* codes.
-- ============================================================

drop policy if exists "accounts_update_owner"                    on public.accounts;
drop policy if exists "venues_update"                            on public.venues;
drop policy if exists "user_venue_roles_select_manager"          on public.user_venue_roles;
drop policy if exists "user_venue_roles_insert"                  on public.user_venue_roles;
drop policy if exists "user_venue_roles_update"                  on public.user_venue_roles;
drop policy if exists "user_venue_roles_delete"                  on public.user_venue_roles;
drop policy if exists "invitations_select_manager"               on public.invitations;
drop policy if exists "invitations_insert_manager"               on public.invitations;
drop policy if exists "invitations_update_manager"               on public.invitations;
drop policy if exists "invitations_delete_manager"               on public.invitations;
drop policy if exists "roles_insert_manage"                      on public.roles;
drop policy if exists "roles_update_manage"                      on public.roles;
drop policy if exists "roles_delete_manage"                      on public.roles;
drop policy if exists "role_permissions_insert_manage"           on public.role_permissions;
drop policy if exists "role_permissions_update_manage"           on public.role_permissions;
drop policy if exists "role_permissions_delete_manage"           on public.role_permissions;
drop policy if exists "account_role_permissions_insert_manage"   on public.account_role_permissions;
drop policy if exists "account_role_permissions_update_manage"   on public.account_role_permissions;
drop policy if exists "account_role_permissions_delete_manage"   on public.account_role_permissions;
drop policy if exists "profiles_update_venue_staff"              on public.profiles;
drop policy if exists "staff_docs_insert"                        on storage.objects;
drop policy if exists "staff_docs_update"                        on storage.objects;
drop policy if exists "staff_docs_delete"                        on storage.objects;

-- ============================================================
-- 2. Wipe permissions (cascades to role_permissions and
--    account_role_permissions via ON DELETE CASCADE).
-- ============================================================

delete from public.permissions;

-- ============================================================
-- 3. Insert 48 new permission codes (5 namespaces).
--    Stable IDs in 10000000-* are reused — old codes are gone.
-- ============================================================

insert into public.permissions (id, code, description, module) values
  -- People (8)
  ('10000000-0000-0000-0000-000000000001', 'people.view_staff',           'Видеть список сотрудников',                                'people'),
  ('10000000-0000-0000-0000-000000000002', 'people.view_staff_details',   'Видеть детальную карточку сотрудника (ПДн, документы)',    'people'),
  ('10000000-0000-0000-0000-000000000003', 'people.invite_staff',         'Приглашать новых сотрудников',                             'people'),
  ('10000000-0000-0000-0000-000000000004', 'people.edit_staff',           'Редактировать данные сотрудников',                         'people'),
  ('10000000-0000-0000-0000-000000000005', 'people.terminate_staff',      'Увольнять сотрудников',                                    'people'),
  ('10000000-0000-0000-0000-000000000006', 'people.delete_staff',         'Полное удаление сотрудника (только для owner)',            'people'),
  ('10000000-0000-0000-0000-000000000007', 'people.view_roles',           'Видеть список ролей и их прав',                            'people'),
  ('10000000-0000-0000-0000-000000000008', 'people.manage_roles',         'Создавать/редактировать кастомные роли',                   'people'),

  -- Org (9)
  ('10000000-0000-0000-0000-000000000009', 'org.view_account',            'Видеть общую информацию об аккаунте',                      'org'),
  ('10000000-0000-0000-0000-000000000010', 'org.manage_account',          'Редактировать аккаунт',                                    'org'),
  ('10000000-0000-0000-0000-000000000011', 'org.view_legal_entities',     'Видеть список юрлиц',                                      'org'),
  ('10000000-0000-0000-0000-000000000012', 'org.manage_legal_entities',   'Создавать/редактировать юрлица и их реквизиты',            'org'),
  ('10000000-0000-0000-0000-000000000013', 'org.delete_legal_entity',     'Удалять юрлицо (только owner)',                            'org'),
  ('10000000-0000-0000-0000-000000000014', 'org.view_venues',             'Видеть список заведений',                                  'org'),
  ('10000000-0000-0000-0000-000000000015', 'org.manage_venues',           'Создавать/редактировать заведения',                        'org'),
  ('10000000-0000-0000-0000-000000000016', 'org.delete_venue',            'Удалять заведения',                                        'org'),
  ('10000000-0000-0000-0000-000000000017', 'org.view_audit',              'Видеть журнал аудита',                                     'org'),

  -- Finance (18)
  ('10000000-0000-0000-0000-000000000018', 'finance.view_dashboard',          'Видеть главный финансовый дашборд',           'finance'),
  ('10000000-0000-0000-0000-000000000019', 'finance.view_transactions',       'Видеть список транзакций',                    'finance'),
  ('10000000-0000-0000-0000-000000000020', 'finance.create_transaction',      'Создавать транзакции',                        'finance'),
  ('10000000-0000-0000-0000-000000000021', 'finance.update_transaction',      'Редактировать свои транзакции',               'finance'),
  ('10000000-0000-0000-0000-000000000022', 'finance.update_any_transaction',  'Редактировать любые транзакции',              'finance'),
  ('10000000-0000-0000-0000-000000000023', 'finance.delete_transaction',      'Удалять транзакции (мягкое)',                 'finance'),
  ('10000000-0000-0000-0000-000000000024', 'finance.view_bank_accounts',      'Видеть банковские счета и балансы',           'finance'),
  ('10000000-0000-0000-0000-000000000025', 'finance.manage_bank_accounts',    'Создавать/редактировать счета',               'finance'),
  ('10000000-0000-0000-0000-000000000026', 'finance.view_categories',         'Видеть статьи доходов/расходов',              'finance'),
  ('10000000-0000-0000-0000-000000000027', 'finance.manage_categories',       'Создавать/редактировать статьи',              'finance'),
  ('10000000-0000-0000-0000-000000000028', 'finance.view_counterparties',     'Видеть контрагентов',                         'finance'),
  ('10000000-0000-0000-0000-000000000029', 'finance.manage_counterparties',   'Создавать/редактировать контрагентов',        'finance'),
  ('10000000-0000-0000-0000-000000000030', 'finance.upload_attachments',      'Прикреплять файлы (чеки, договоры)',          'finance'),
  ('10000000-0000-0000-0000-000000000031', 'finance.view_attachments',        'Видеть/скачивать прикреплённые файлы',        'finance'),
  ('10000000-0000-0000-0000-000000000032', 'finance.delete_attachments',      'Удалять прикреплённые файлы',                 'finance'),
  ('10000000-0000-0000-0000-000000000033', 'finance.export',                  'Экспорт данных в Excel/CSV',                  'finance'),
  ('10000000-0000-0000-0000-000000000034', 'finance.view_all_venues',         'Видеть финансы всех точек одновременно',      'finance'),
  ('10000000-0000-0000-0000-000000000035', 'finance.view_all_legal_entities', 'Видеть финансы всех юрлиц одновременно',      'finance'),

  -- CRM (9)
  ('10000000-0000-0000-0000-000000000036', 'crm.view_guests',              'Видеть базу гостей',                            'crm'),
  ('10000000-0000-0000-0000-000000000037', 'crm.view_guest_details',       'Видеть детальную карточку гостя',               'crm'),
  ('10000000-0000-0000-0000-000000000038', 'crm.manage_guests',            'Создавать/редактировать гостей',                'crm'),
  ('10000000-0000-0000-0000-000000000039', 'crm.view_reservations',        'Видеть брони',                                  'crm'),
  ('10000000-0000-0000-0000-000000000040', 'crm.manage_reservations',      'Создавать/редактировать брони',                 'crm'),
  ('10000000-0000-0000-0000-000000000041', 'crm.cancel_reservation',       'Отменять брони',                                'crm'),
  ('10000000-0000-0000-0000-000000000042', 'crm.view_loyalty',             'Видеть программы лояльности',                   'crm'),
  ('10000000-0000-0000-0000-000000000043', 'crm.manage_loyalty',           'Управлять программами лояльности',              'crm'),
  ('10000000-0000-0000-0000-000000000044', 'crm.adjust_loyalty_balance',   'Ручная корректировка баланса гостя',            'crm'),

  -- Settings (4)
  ('10000000-0000-0000-0000-000000000045', 'settings.manage_integrations',    'Подключать/отключать интеграции',          'settings'),
  ('10000000-0000-0000-0000-000000000046', 'settings.manage_notifications',   'Управлять рассылками',                     'settings'),
  ('10000000-0000-0000-0000-000000000047', 'settings.manage_billing',         'Управлять подпиской и оплатой',            'settings'),
  ('10000000-0000-0000-0000-000000000048', 'settings.use_dadata',             'Делать запросы к DaData (cleaner API)',    'settings');

-- ============================================================
-- 4. Add 6th system role: accountant.
-- ============================================================

insert into public.roles (id, account_id, name, code) values
  ('00000000-0000-0000-0000-000000000006', null, 'Бухгалтер', 'accountant')
on conflict (id) do nothing;

-- ============================================================
-- 5. Default role_permissions matrix (MERGE_PLAN §4.3).
--    Insert one batch per role; absence of a row = denied.
-- ============================================================

-- 5.1 Owner: all 48 permissions.
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000001', p.id, true
from public.permissions p;

-- 5.2 Admin (almost all except critical destructive / billing / loyalty-adjust).
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000003', p.id, true
from public.permissions p
where p.code in (
  -- People
  'people.view_staff', 'people.view_staff_details',
  'people.invite_staff', 'people.edit_staff', 'people.terminate_staff',
  'people.view_roles', 'people.manage_roles',
  -- Org
  'org.view_account', 'org.view_legal_entities',
  'org.view_venues', 'org.manage_venues',
  'org.view_audit',
  -- Finance
  'finance.view_dashboard', 'finance.view_transactions',
  'finance.create_transaction', 'finance.update_transaction',
  'finance.update_any_transaction', 'finance.delete_transaction',
  'finance.view_bank_accounts', 'finance.manage_bank_accounts',
  'finance.view_categories', 'finance.manage_categories',
  'finance.view_counterparties', 'finance.manage_counterparties',
  'finance.upload_attachments', 'finance.view_attachments',
  'finance.delete_attachments', 'finance.export',
  'finance.view_all_venues', 'finance.view_all_legal_entities',
  -- CRM
  'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
  'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
  'crm.view_loyalty', 'crm.manage_loyalty',
  -- Settings
  'settings.manage_integrations', 'settings.manage_notifications',
  'settings.use_dadata'
);

-- 5.3 Manager (operations on own venue: staff, reservations, day-to-day txns).
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000002', p.id, true
from public.permissions p
where p.code in (
  -- People
  'people.view_staff', 'people.view_staff_details',
  'people.invite_staff', 'people.edit_staff',
  'people.view_roles',
  -- Org
  'org.view_account', 'org.view_venues',
  -- Finance
  'finance.view_dashboard', 'finance.view_transactions',
  'finance.create_transaction', 'finance.update_transaction',
  'finance.view_bank_accounts',
  'finance.view_categories', 'finance.view_counterparties',
  'finance.upload_attachments', 'finance.view_attachments',
  -- CRM
  'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
  'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation',
  'crm.view_loyalty',
  -- Settings
  'settings.manage_notifications',
  'settings.use_dadata'
);

-- 5.4 Accountant (full finance + legal entities + read people/venues; no CRM).
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000006', p.id, true
from public.permissions p
where p.code in (
  -- People
  'people.view_staff', 'people.view_staff_details',
  -- Org
  'org.view_account',
  'org.view_legal_entities', 'org.manage_legal_entities',
  'org.view_venues', 'org.view_audit',
  -- Finance (everything except destructive across-entity stuff)
  'finance.view_dashboard', 'finance.view_transactions',
  'finance.create_transaction', 'finance.update_transaction',
  'finance.update_any_transaction', 'finance.delete_transaction',
  'finance.view_bank_accounts', 'finance.manage_bank_accounts',
  'finance.view_categories', 'finance.manage_categories',
  'finance.view_counterparties', 'finance.manage_counterparties',
  'finance.upload_attachments', 'finance.view_attachments',
  'finance.delete_attachments', 'finance.export',
  'finance.view_all_venues', 'finance.view_all_legal_entities',
  -- Settings
  'settings.use_dadata'
);

-- 5.5 Hostess (guest seating, reservations).
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000004', p.id, true
from public.permissions p
where p.code in (
  'org.view_venues',
  'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
  'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation'
);

-- 5.6 Waiter (basic guest/reservation view for the active shift).
insert into public.role_permissions (role_id, permission_id, granted)
select '00000000-0000-0000-0000-000000000005', p.id, true
from public.permissions p
where p.code in (
  'org.view_venues',
  'crm.view_guests',
  'crm.view_reservations', 'crm.manage_reservations'
);

-- ============================================================
-- 6. Recreate set_effective_role_permission with the new code.
-- ============================================================

create or replace function public.set_effective_role_permission(
  p_role_id uuid,
  p_permission_id uuid,
  p_granted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_role_account_id uuid;
  v_role_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('people.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_account_id := public.get_active_account_id();
  if v_account_id is null then
    raise exception 'Active account is not set';
  end if;

  select r.account_id, r.code
    into v_role_account_id, v_role_code
  from public.roles r
  where r.id = p_role_id;

  if not found then
    raise exception 'Role not found';
  end if;

  if v_role_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;

  perform 1 from public.permissions p where p.id = p_permission_id;
  if not found then
    raise exception 'Permission not found';
  end if;

  if v_role_account_id is null then
    -- System role: account-scoped override.
    insert into public.account_role_permissions (
      account_id, role_id, permission_id, granted, updated_at
    )
    values (
      v_account_id, p_role_id, p_permission_id, p_granted, now()
    )
    on conflict (account_id, role_id, permission_id)
    do update set granted = excluded.granted, updated_at = now();
  elsif v_role_account_id = v_account_id then
    -- Custom role: account-owned source of truth.
    insert into public.role_permissions (role_id, permission_id, granted)
    values (p_role_id, p_permission_id, p_granted)
    on conflict (role_id, permission_id)
    do update set granted = excluded.granted;
  else
    raise exception 'Role is outside active account';
  end if;
end;
$$;

-- ============================================================
-- 7. Recreate dropped policies with new permission codes.
-- ============================================================

-- 7.1 accounts UPDATE → org.manage_account
create policy "accounts_update_owner"
  on public.accounts for update
  using (owner_id = auth.uid() and public.has_permission('org.manage_account'));

-- 7.2 venues UPDATE → org.manage_venues
create policy "venues_update"
  on public.venues for update
  using (public.has_permission('org.manage_venues'));

-- 7.3 user_venue_roles SELECT/INSERT/UPDATE/DELETE → people.*
create policy "user_venue_roles_select_manager"
  on public.user_venue_roles for select
  using (public.has_permission('people.view_staff'));

create policy "user_venue_roles_insert"
  on public.user_venue_roles for insert
  with check (public.has_permission('people.invite_staff'));

create policy "user_venue_roles_update"
  on public.user_venue_roles for update
  using (public.has_permission('people.edit_staff'));

create policy "user_venue_roles_delete"
  on public.user_venue_roles for delete
  using (public.has_permission('people.terminate_staff'));

-- 7.4 invitations SELECT/INSERT/UPDATE/DELETE → people.invite_staff
create policy "invitations_select_manager"
  on public.invitations for select
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('people.invite_staff')
  );

create policy "invitations_insert_manager"
  on public.invitations for insert
  with check (
    venue_id = public.get_active_venue_id()
    and public.has_permission('people.invite_staff')
  );

create policy "invitations_update_manager"
  on public.invitations for update
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('people.invite_staff')
  );

create policy "invitations_delete_manager"
  on public.invitations for delete
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('people.invite_staff')
  );

-- 7.5 roles INSERT/UPDATE/DELETE → people.manage_roles (custom roles only).
create policy "roles_insert_manage"
  on public.roles for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

create policy "roles_update_manage"
  on public.roles for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

create policy "roles_delete_manage"
  on public.roles for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

-- 7.6 role_permissions INSERT/UPDATE/DELETE → people.manage_roles.
--     Pattern from migration 023 — allow direct writes for non-owner system
--     roles OR custom roles; the trigger from 023 redirects system-role
--     writes into account_role_permissions overrides.
create policy "role_permissions_insert_manage"
  on public.role_permissions for insert
  with check (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.account_id = public.get_active_account_id()
          or r.account_id is null
        )
    )
  );

create policy "role_permissions_update_manage"
  on public.role_permissions for update
  using (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.account_id = public.get_active_account_id()
          or r.account_id is null
        )
    )
  );

create policy "role_permissions_delete_manage"
  on public.role_permissions for delete
  using (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.account_id = public.get_active_account_id()
    )
  );

-- 7.7 account_role_permissions INSERT/UPDATE/DELETE → people.manage_roles.
create policy "account_role_permissions_insert_manage"
  on public.account_role_permissions for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

create policy "account_role_permissions_update_manage"
  on public.account_role_permissions for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

create policy "account_role_permissions_delete_manage"
  on public.account_role_permissions for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = account_role_permissions.role_id
        and r.account_id is null
        and r.code != 'owner'
    )
  );

-- 7.8 profiles UPDATE → people.edit_staff (manager/admin/owner editing
--     staff profiles in their venue). Pattern from 016.
create policy "profiles_update_venue_staff"
  on public.profiles for update
  using (
    id != auth.uid()
    and public.has_permission('people.edit_staff')
    and exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id  = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
    )
  );

-- 7.9 storage.objects: staff_docs writes → people.edit_staff.
--     SELECT (staff_docs_select) is not gated by manage_staff and stays
--     as defined by migration 016.
create policy "staff_docs_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('people.edit_staff')
  );

create policy "staff_docs_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('people.edit_staff')
  );

create policy "staff_docs_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('people.edit_staff')
  );

-- ============================================================
-- 8. RLS for legal_entities (table created in migration 032).
-- ============================================================

alter table public.legal_entities enable row level security;

create policy "legal_entities_select"
  on public.legal_entities for select
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('org.view_legal_entities')
  );

create policy "legal_entities_insert"
  on public.legal_entities for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('org.manage_legal_entities')
  );

create policy "legal_entities_update"
  on public.legal_entities for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('org.manage_legal_entities')
  );

create policy "legal_entities_delete"
  on public.legal_entities for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('org.delete_legal_entity')
  );
