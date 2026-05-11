-- ============================================================
-- Stage: staff data split
--
-- Тенант-специфичные поля сотрудника уезжают из public.profiles.
-- Причина: profiles шарится между всеми работодателями (одна
-- запись на auth.users.id). Поэтому документы, мед-книжка,
-- внутренняя заметка HR и дата трудоустройства должны жить в
-- скоупе аккаунта, а PIN терминала — в скоупе venue (свой POS).
--
-- Цель миграции:
--  • profiles становится чисто персональным (имя, телефон,
--    telegram, гендер, ДР, адрес, аватар) — user-owned;
--  • staff_account_details (account_id, user_id) — account-scoped
--    (employment_date, medical_book, passport_photos, comment),
--    управляется HR через people.edit_staff;
--  • user_venue_roles.terminal_pin — venue-scoped POS-PIN;
--  • profiles.birth_date_set_at + триггер — фундамент под
--    антифрод бонуса на день рождения (отдельной фичи ещё нет,
--    но ставим маркер при изменении ДР).
--
-- Идемпотентность: все DDL через `if [not] exists`/`drop ... if
-- exists`. Backfill безопасный через `on conflict do nothing` /
-- guard'ы по null'ам.
-- ============================================================

-- ── 1. Новая таблица staff_account_details ─────────────────

create table if not exists public.staff_account_details (
  account_id          uuid not null references public.accounts(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  employment_date     date,
  medical_book_number text,
  medical_book_date   date,
  passport_photos     text[] not null default '{}',
  comment             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  primary key (account_id, user_id)
);

create index if not exists staff_account_details_user_idx
  on public.staff_account_details (user_id);

alter table public.staff_account_details enable row level security;

-- RLS: read — если caller активный член любого venue этого аккаунта.
drop policy if exists "sad_select_member" on public.staff_account_details;
create policy "sad_select_member"
  on public.staff_account_details for select
  using (
    exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and v.account_id = staff_account_details.account_id
    )
  );

-- Write — только в активном аккаунте + people.edit_staff.
drop policy if exists "sad_insert_manage" on public.staff_account_details;
create policy "sad_insert_manage"
  on public.staff_account_details for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.edit_staff')
  );

drop policy if exists "sad_update_manage" on public.staff_account_details;
create policy "sad_update_manage"
  on public.staff_account_details for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.edit_staff')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.edit_staff')
  );

drop policy if exists "sad_delete_manage" on public.staff_account_details;
create policy "sad_delete_manage"
  on public.staff_account_details for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.edit_staff')
  );

grant select, insert, update, delete on public.staff_account_details to anon, authenticated;

-- Триггер автоматически обновлять updated_at + updated_by.
create or replace function public.tg_sad_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists trg_sad_set_updated on public.staff_account_details;
create trigger trg_sad_set_updated
  before update on public.staff_account_details
  for each row execute function public.tg_sad_set_updated();

create or replace function public.tg_sad_set_created()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sad_set_created on public.staff_account_details;
create trigger trg_sad_set_created
  before insert on public.staff_account_details
  for each row execute function public.tg_sad_set_created();

-- ── 2. terminal_pin → user_venue_roles ─────────────────────

alter table public.user_venue_roles
  add column if not exists terminal_pin text;

-- ── 3. profiles.birth_date_set_at + триггер ───────────────

alter table public.profiles
  add column if not exists birth_date_set_at timestamptz;

-- Триггер: при INSERT/UPDATE birth_date обновляем set_at.
-- Будущая бонус-логика смотрит этот timestamp: если ДР установлено
-- меньше 6 месяцев назад — бонус в этом году не выдаётся.
create or replace function public.tg_profiles_track_birth_date()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' and new.birth_date is not null)
     or (tg_op = 'UPDATE' and new.birth_date is distinct from old.birth_date) then
    new.birth_date_set_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_birth_date on public.profiles;
create trigger trg_profiles_birth_date
  before insert or update on public.profiles
  for each row execute function public.tg_profiles_track_birth_date();

-- ── 4. Backfill staff_account_details из profiles ─────────

-- distinct on (account_id, user_id): если юзер работает в N venues
-- одного account_id, берём первую попавшуюся запись (значения уже
-- идентичны — они из шаренного profiles ряда).
insert into public.staff_account_details (
  account_id, user_id, employment_date, medical_book_number,
  medical_book_date, passport_photos, comment
)
select distinct on (v.account_id, p.id)
  v.account_id,
  p.id,
  p.employment_date,
  p.medical_book_number,
  p.medical_book_date,
  coalesce(p.passport_photos, '{}'::text[]),
  p.comment
from public.profiles p
join public.user_venue_roles uvr on uvr.user_id = p.id
join public.venues v on v.id = uvr.venue_id
where uvr.status = 'active'
  and (
    p.employment_date is not null
    or p.medical_book_number is not null
    or p.medical_book_date is not null
    or coalesce(array_length(p.passport_photos, 1), 0) > 0
    or p.comment is not null
  )
on conflict (account_id, user_id) do nothing;

-- terminal_pin → UVR. Обходим триггер obновления updated_at тут не
-- нужен — UVR его не имеет; просто SET.
update public.user_venue_roles uvr
set terminal_pin = p.terminal_pin
from public.profiles p
where uvr.user_id = p.id
  and p.terminal_pin is not null
  and uvr.status = 'active';

-- birth_date_set_at: для уже заполненных ДР ставим created_at профиля
-- (триггер из шага 3 на UPDATE не сработает — мы НЕ меняем birth_date).
update public.profiles
set birth_date_set_at = created_at
where birth_date is not null and birth_date_set_at is null;

-- ── 5. Drop старых колонок с profiles ─────────────────────

alter table public.profiles
  drop column if exists employment_date,
  drop column if exists medical_book_number,
  drop column if exists medical_book_date,
  drop column if exists passport_photos,
  drop column if exists comment,
  drop column if exists terminal_pin;

-- ── 6. Пересоздаём get_venue_staff с JOIN на staff_account_details

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
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    uvr.created_at                                                  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join public.venues    v  on v.id  = uvr.venue_id
  join auth.users       au on au.id = uvr.user_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
    -- caller должен сам быть активным членом этого venue
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;

-- ── 7. Зачистка лишних триггеров ───────────────────────────

-- Триггер из миграции 013 писал profiles.employment_date при INSERT
-- в user_venue_roles. После миграции колонки нет; логика «когда
-- сотрудник начал работать в этом venue» теперь выводится через
-- coalesce(sad.employment_date, uvr.created_at::date) в RPC.
drop trigger if exists trg_set_employment_date on public.user_venue_roles;
drop function if exists public.set_employment_date_on_join();
