-- ============================================================
-- 003_rls_policies.sql
-- RLS-политики и вспомогательные функции
-- ============================================================

-- ============================================================
-- Вспомогательные функции
-- ============================================================

-- get_active_venue_id() — возвращает active_venue_id текущего пользователя
create or replace function public.get_active_venue_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select active_venue_id
  from public.profiles
  where id = auth.uid();
$$;

-- has_permission() — проверяет право в активном заведении текущего пользователя
create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_venue_roles uvr
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions p on p.id = rp.permission_id
    where uvr.user_id = auth.uid()
      and uvr.venue_id = public.get_active_venue_id()
      and p.code = permission_code
      and rp.granted = true
  );
$$;

-- get_user_venues() — список заведений текущего пользователя с ролями
create or replace function public.get_user_venues()
returns table (
  venue_id   uuid,
  venue_name text,
  role_code  text,
  role_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id as venue_id,
    v.name as venue_name,
    r.code as role_code,
    r.name as role_name
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.roles r on r.id = uvr.role_id
  where uvr.user_id = auth.uid()
  order by v.name;
$$;

-- ============================================================
-- RLS — включаем на всех таблицах
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.accounts         enable row level security;
alter table public.venues           enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_venue_roles enable row level security;
alter table public.invitations      enable row level security;

-- ============================================================
-- profiles
-- ============================================================
-- Пользователь видит и редактирует только свой профиль
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- Автоматическое создание профиля при регистрации (через trigger)
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

-- ============================================================
-- accounts
-- ============================================================
-- Владелец видит свой аккаунт
create policy "accounts_select_owner"
  on public.accounts for select
  using (owner_id = auth.uid());

-- Сотрудники видят аккаунт своих заведений
create policy "accounts_select_staff"
  on public.accounts for select
  using (
    exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and v.account_id = accounts.id
    )
  );

create policy "accounts_insert_owner"
  on public.accounts for insert
  with check (owner_id = auth.uid());

create policy "accounts_update_owner"
  on public.accounts for update
  using (owner_id = auth.uid() and public.has_permission('platform.manage_account'));

-- ============================================================
-- venues
-- ============================================================
-- Видят заведения, к которым привязаны
create policy "venues_select_member"
  on public.venues for select
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id = venues.id
    )
  );

-- Владелец аккаунта видит все заведения аккаунта
create policy "venues_select_account_owner"
  on public.venues for select
  using (
    exists (
      select 1 from public.accounts a
      where a.id = venues.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "venues_insert"
  on public.venues for insert
  with check (
    exists (
      select 1 from public.accounts a
      where a.id = venues.account_id
        and a.owner_id = auth.uid()
    )
  );

create policy "venues_update"
  on public.venues for update
  using (public.has_permission('platform.manage_venues'));

-- ============================================================
-- roles
-- ============================================================
-- Системные роли (account_id = null) видны всем аутентифицированным
create policy "roles_select_system"
  on public.roles for select
  using (account_id is null and auth.uid() is not null);

-- Роли аккаунта видны сотрудникам заведений этого аккаунта
create policy "roles_select_account"
  on public.roles for select
  using (
    account_id is not null and
    exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and v.account_id = roles.account_id
    )
  );

-- ============================================================
-- permissions
-- ============================================================
-- Все права видны всем аутентифицированным (справочник)
create policy "permissions_select_all"
  on public.permissions for select
  using (auth.uid() is not null);

-- ============================================================
-- role_permissions
-- ============================================================
create policy "role_permissions_select"
  on public.role_permissions for select
  using (auth.uid() is not null);

-- ============================================================
-- user_venue_roles
-- ============================================================
create policy "user_venue_roles_select_own"
  on public.user_venue_roles for select
  using (user_id = auth.uid());

-- Менеджер/владелец видит всех сотрудников своих заведений
create policy "user_venue_roles_select_manager"
  on public.user_venue_roles for select
  using (public.has_permission('platform.manage_staff'));

create policy "user_venue_roles_insert"
  on public.user_venue_roles for insert
  with check (public.has_permission('platform.manage_staff'));

create policy "user_venue_roles_update"
  on public.user_venue_roles for update
  using (public.has_permission('platform.manage_staff'));

-- ============================================================
-- invitations
-- ============================================================
create policy "invitations_select_manager"
  on public.invitations for select
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('platform.manage_staff')
  );

create policy "invitations_insert_manager"
  on public.invitations for insert
  with check (
    venue_id = public.get_active_venue_id()
    and public.has_permission('platform.manage_staff')
  );

create policy "invitations_update_manager"
  on public.invitations for update
  using (
    venue_id = public.get_active_venue_id()
    and public.has_permission('platform.manage_staff')
  );
