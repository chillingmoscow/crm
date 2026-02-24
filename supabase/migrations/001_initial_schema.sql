-- ============================================================
-- 001_initial_schema.sql
-- Платформенное ядро: таблицы, enum-типы, RLS, функции
-- ============================================================

-- Enum-типы
create type venue_type as enum ('restaurant', 'bar', 'cafe', 'club', 'other');
create type invitation_status as enum ('pending', 'accepted', 'expired');

-- ============================================================
-- Таблица profiles
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  phone       text,
  photo_url   text,
  active_venue_id uuid, -- FK добавим после создания venues
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Профили пользователей (1:1 с auth.users)';

-- ============================================================
-- Таблица accounts
-- ============================================================
create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  owner_id    uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now()
);

comment on table public.accounts is 'Аккаунты владельцев (один владелец — один аккаунт)';

-- ============================================================
-- Таблица venues
-- ============================================================
create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  name          text not null,
  logo_url      text,
  type          venue_type not null default 'restaurant',
  address       text,
  phone         text,
  currency      text not null default 'RUB',
  timezone      text not null default 'Europe/Moscow',
  working_hours jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.venues is 'Заведения, принадлежащие аккаунту';
comment on column public.venues.working_hours is 'Часы работы: { "mon": { "open": "10:00", "close": "23:00", "closed": false }, ... }';

-- Добавляем FK от profiles к venues (после создания venues)
alter table public.profiles
  add constraint profiles_active_venue_id_fkey
  foreign key (active_venue_id) references public.venues(id) on delete set null;

-- ============================================================
-- Таблица roles
-- ============================================================
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references public.accounts(id) on delete cascade,
  name        text not null,
  code        text not null,
  constraint roles_code_account_unique unique (code, account_id)
);

comment on table public.roles is 'Роли. account_id = null — системная роль';
comment on column public.roles.account_id is 'null = системная роль, uuid = роль аккаунта';

-- ============================================================
-- Таблица permissions
-- ============================================================
create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  description text not null,
  module      text not null
);

comment on table public.permissions is 'Реестр прав доступа';

-- ============================================================
-- Таблица role_permissions (матрица прав)
-- ============================================================
create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted       boolean not null default true,
  primary key (role_id, permission_id)
);

comment on table public.role_permissions is 'Матрица: роль → право → разрешено/нет';

-- ============================================================
-- Таблица user_venue_roles
-- ============================================================
create table public.user_venue_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  venue_id    uuid not null references public.venues(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete restrict,
  invited_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint user_venue_roles_unique unique (user_id, venue_id)
);

comment on table public.user_venue_roles is 'Связь пользователя с заведением и ролью';

-- ============================================================
-- Таблица invitations
-- ============================================================
create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  email       text not null,
  role_id     uuid not null references public.roles(id) on delete restrict,
  invited_by  uuid not null references public.profiles(id) on delete restrict,
  status      invitation_status not null default 'pending',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days')
);

comment on table public.invitations is 'Приглашения сотрудников';

-- Индексы
create index invitations_email_idx on public.invitations(email);
create index invitations_venue_id_idx on public.invitations(venue_id);
create index user_venue_roles_user_id_idx on public.user_venue_roles(user_id);
create index user_venue_roles_venue_id_idx on public.user_venue_roles(venue_id);
create index venues_account_id_idx on public.venues(account_id);
