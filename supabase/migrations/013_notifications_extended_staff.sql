-- ============================================================
-- 013_notifications_extended_staff.sql
-- 1. Таблица уведомлений
-- 2. Расширяем get_venue_staff (телефон, telegram, пол, дата рождения, дата трудоустройства)
-- 3. Триггер — автоматически ставить employment_date при добавлении в заведение
-- ============================================================

-- ── 1. Notifications ────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  venue_id   uuid        references public.venues(id) on delete set null,
  type       text        not null default 'system',
  title      text        not null,
  body       text,
  link       text,
  read       boolean     not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid());

create index if not exists notifications_user_id_idx
  on public.notifications (user_id, created_at desc);

-- ── 2. Trigger: auto-fill employment_date when user joins venue ──
create or replace function public.set_employment_date_on_join()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  update public.profiles
  set    employment_date = NEW.created_at::date
  where  id = NEW.user_id
    and  employment_date is null;
  return NEW;
end;
$$;

drop trigger if exists trg_set_employment_date on public.user_venue_roles;
create trigger trg_set_employment_date
  after insert on public.user_venue_roles
  for each row execute function public.set_employment_date_on_join();

-- ── 3. Recreate get_venue_staff with extended profile fields ──
drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id          uuid,
  user_id         uuid,
  role_id         uuid,
  role_name       text,
  role_code       text,
  first_name      text,
  last_name       text,
  email           text,
  avatar_url      text,
  phone           text,
  telegram_id     text,
  gender          text,
  birth_date      date,
  employment_date date,
  joined_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id                                                          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name                                                          as role_name,
    r.code                                                          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(p.employment_date, uvr.created_at::date)              as employment_date,
    uvr.created_at                                                  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
  order by uvr.created_at;
$$;
