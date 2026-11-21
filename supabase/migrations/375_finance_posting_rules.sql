-- Правила разнесения операций: «если все условия — заполнить статью /
-- контрагента / заведение». Дизайн — docs/superpowers/specs/2026-11-21-finance-posting-rules-design.md.
--
-- Правила общие на аккаунт. Условия — jsonb-список «поле / оператор / значение»
-- (новые виды условий, например банковские поля, добавляются без миграции
-- схемы); id справочников внутри условий без FK — правило со ссылкой на
-- архивную или удалённую запись приложение помечает «Требует внимания» и не
-- применяет. Действия — отдельные колонки с композитными FK.
--
-- Видеть — finance.view_transactions (иначе в форме непонятно, откуда
-- взялась статья); настраивать — новое право finance.manage_posting_rules.
begin;

-- 1. Право. Существующим ролям — тем, у кого есть finance.manage_categories
-- (владелец, управляющий, администратор и их клоны).
insert into public.permissions (code, module, description)
values (
  'finance.manage_posting_rules',
  'finance',
  'Настраивать правила разнесения операций'
)
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_id, granted)
select rp.role_id, n.id, true
from public.role_permissions rp
join public.permissions o on o.id = rp.permission_id and o.code = 'finance.manage_categories'
cross join public.permissions n
where n.code = 'finance.manage_posting_rules'
  and rp.granted
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- Новым заведениям — через преcет ролей. Тело — из 229 без изменений, кроме
-- нового кода рядом с finance.manage_counterparties (управляющий и администратор).
create or replace function public.seed_default_venue_roles_impl(p_venue_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_catalog
as $$
declare
  v_manager_id    uuid;
  v_admin_id      uuid;
  v_accountant_id uuid;
  v_hostess_id    uuid;
  v_waiter_id     uuid;
begin
  -- Guard: если в venue уже есть кастомные роли — пропускаем.
  if exists (
    select 1 from public.roles where venue_id = p_venue_id
  ) then
    return;
  end if;

  -- Управляющий
  -- account_id больше не пишем: колонку убрала миграция 172 (Stage D),
  -- роль привязана к заведению через venue_id.
  insert into public.roles (venue_id, name, code)
  values (p_venue_id, 'Управляющий', 'custom_manager')
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
  )
  on conflict (role_id, permission_id) do update set granted = true;

  -- Администратор
  insert into public.roles (venue_id, name, code)
  values (p_venue_id, 'Администратор', 'custom_admin')
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
    'finance.manage_posting_rules',
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
  )
  on conflict (role_id, permission_id) do update set granted = true;

  -- Бухгалтер
  insert into public.roles (venue_id, name, code)
  values (p_venue_id, 'Бухгалтер', 'custom_accountant')
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
    'finance.manage_posting_rules',
    'finance.upload_attachments', 'finance.view_attachments',
    'finance.delete_attachments', 'finance.export',
    'finance.view_all_venues', 'finance.view_all_legal_entities',
    'settings.use_dadata'
  )
  on conflict (role_id, permission_id) do update set granted = true;

  -- Хостес
  insert into public.roles (venue_id, name, code)
  values (p_venue_id, 'Хостес', 'custom_hostess')
  returning id into v_hostess_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_hostess_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'inventory.fill_assigned_documents',
    'crm.view_guests', 'crm.view_guest_details', 'crm.manage_guests',
    'crm.view_reservations', 'crm.manage_reservations', 'crm.cancel_reservation'
  )
  on conflict (role_id, permission_id) do update set granted = true;

  -- Официант
  insert into public.roles (venue_id, name, code)
  values (p_venue_id, 'Официант', 'custom_waiter')
  returning id into v_waiter_id;
  insert into public.role_permissions (role_id, permission_id, granted)
  select v_waiter_id, id, true from public.permissions
  where code in (
    'org.view_venues',
    'inventory.fill_assigned_documents',
    'crm.view_guests',
    'crm.view_reservations', 'crm.manage_reservations'
  )
  on conflict (role_id, permission_id) do update set granted = true;
end;
$$;

-- impl зовут только обёртка (она security definer, то есть владелец функции) и
-- бэкфилл ниже. Наружу не отдаём: без проверок вызывающего это дыра — любой
-- authenticated мог бы засеять роли в чужое заведение, зная его UUID.
revoke all on function public.seed_default_venue_roles_impl(uuid) from public;
revoke all on function public.seed_default_venue_roles_impl(uuid) from anon, authenticated;

comment on function public.seed_default_venue_roles_impl(uuid) is
  'Преcет из 5 кастомных ролей (Управляющий, Администратор, Бухгалтер, Хостес, '
  'Официант) с дефолтными правами в указанном заведении. Идемпотентна. '
  'Без проверок вызывающего — вызывать только через seed_default_venue_roles.';


-- 2. Таблица правил.
create table public.finance_posting_rules (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text check (name is null or length(btrim(name)) between 1 and 200),
  position    integer not null,
  enabled     boolean not null default true,
  conditions  jsonb not null
    check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) between 1 and 20),
  action_category_id     uuid,
  action_counterparty_id uuid,
  action_venue_id        uuid,
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint finance_posting_rules_account_id_id_key unique (account_id, id),
  -- «Хотя бы одно действие» проверяет приложение: удаление статьи обнуляет
  -- колонку через set null, и check в БД сломал бы удаление статьи.
  constraint finance_posting_rules_category_fkey
    foreign key (account_id, action_category_id)
    references public.finance_categories(account_id, id)
    on delete set null (action_category_id),
  constraint finance_posting_rules_counterparty_fkey
    foreign key (account_id, action_counterparty_id)
    references public.counterparties(account_id, id)
    on delete set null (action_counterparty_id),
  constraint finance_posting_rules_venue_fkey
    foreign key (account_id, action_venue_id)
    references public.venues(account_id, id)
    on delete set null (action_venue_id)
);

comment on table public.finance_posting_rules is
  'Правила разнесения операций аккаунта: условия (jsonb) → статья / контрагент / заведение. '
  'Порядок — position, срабатывает первое сверху подходящее правило по каждому полю.';

create index finance_posting_rules_position_idx on public.finance_posting_rules(account_id, position);
create index finance_posting_rules_category_idx on public.finance_posting_rules(account_id, action_category_id)
  where action_category_id is not null;
create index finance_posting_rules_counterparty_idx on public.finance_posting_rules(account_id, action_counterparty_id)
  where action_counterparty_id is not null;
create index finance_posting_rules_venue_idx on public.finance_posting_rules(account_id, action_venue_id)
  where action_venue_id is not null;
create index finance_posting_rules_created_by_idx on public.finance_posting_rules(created_by)
  where created_by is not null;
create index finance_posting_rules_updated_by_idx on public.finance_posting_rules(updated_by)
  where updated_by is not null;

-- 3. RLS. Чтение — с доступом к операциям или с правом настройки (роль может
-- иметь manage без view); запись — только с правом настройки.
alter table public.finance_posting_rules enable row level security;

create policy finance_posting_rules_select on public.finance_posting_rules
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and ((select public.has_permission('finance.view_transactions'))
      or (select public.has_permission('finance.manage_posting_rules')))
  );

create policy finance_posting_rules_insert on public.finance_posting_rules
  for insert to authenticated
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_posting_rules'))
  );

create policy finance_posting_rules_update on public.finance_posting_rules
  for update to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_posting_rules'))
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_posting_rules'))
  );

create policy finance_posting_rules_delete on public.finance_posting_rules
  for delete to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('finance.manage_posting_rules'))
  );

revoke all on public.finance_posting_rules from anon;
grant select, insert, update, delete on public.finance_posting_rules to authenticated;

-- 4. Порядок — одной командой: позиции всех правил аккаунта переписываются
-- атомарно, по списку id в новом порядке. Список должен совпадать с правилами
-- аккаунта целиком — иначе кто-то поменял их параллельно.
create or replace function public.finance_posting_rules_reorder(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_account uuid := public.get_active_account_id();
  v_total   integer;
begin
  if v_account is null or not public.has_permission('finance.manage_posting_rules') then
    raise exception 'Недостаточно прав' using errcode = '42501';
  end if;

  select count(*) into v_total
  from public.finance_posting_rules
  where account_id = v_account;

  if p_ids is null
    or cardinality(p_ids) <> v_total
    or (select count(distinct x) from unnest(p_ids) as x) <> v_total
    or exists (
      select 1 from unnest(p_ids) as x
      where not exists (
        select 1 from public.finance_posting_rules r
        where r.id = x and r.account_id = v_account
      )
    )
  then
    raise exception 'Список правил изменился, обновите страницу' using errcode = '40001';
  end if;

  update public.finance_posting_rules r
  set position = o.ord,
      updated_at = now(),
      updated_by = auth.uid()
  from unnest(p_ids) with ordinality as o(id, ord)
  where r.id = o.id
    and r.account_id = v_account
    and r.position is distinct from o.ord;
end;
$$;

revoke all on function public.finance_posting_rules_reorder(uuid[]) from public, anon;
grant execute on function public.finance_posting_rules_reorder(uuid[]) to authenticated;

-- 5. Проверки: REVOKE/GRANT от не-владельца молча ничего не делают.
do $$
begin
  if has_function_privilege('anon', 'public.finance_posting_rules_reorder(uuid[])', 'execute') then
    raise exception 'anon не должен вызывать finance_posting_rules_reorder';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_posting_rules_reorder(uuid[])', 'execute') then
    raise exception 'authenticated должен вызывать finance_posting_rules_reorder';
  end if;
  if has_table_privilege('anon', 'public.finance_posting_rules', 'select') then
    raise exception 'anon не должен читать finance_posting_rules';
  end if;
  if has_function_privilege('anon', 'public.seed_default_venue_roles_impl(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.seed_default_venue_roles_impl(uuid)', 'execute') then
    raise exception 'seed_default_venue_roles_impl не должна быть доступна снаружи';
  end if;
end;
$$;

commit;
