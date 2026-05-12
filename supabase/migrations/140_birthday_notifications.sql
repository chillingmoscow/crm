-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 140_birthday_notifications.sql
--
-- Поздравления сотрудников с ДР:
--   • В день рождения — личное сообщение имениннику (текст AI-генерации)
--   • За 7 дней до — heads-up коллегам по venue'ам, чтобы успели купить
--     подарок / устроить сюрприз
--
-- Идемпотентность: два smallint-маркера на profiles (год последнего
-- уведомления), claim-via-UPDATE-RETURNING — параллельные cron'ы не
-- дублируют.
--
-- Дата считается по календарю Europe/Moscow (МСК) — чтобы привязать к
-- бизнес-дню заведения, а не к UTC.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists birthday_self_notified_year       smallint,
  add column if not exists birthday_colleagues_notified_year smallint;

comment on column public.profiles.birthday_self_notified_year is
  'Год, за который имениннику уже отправлено личное поздравление с ДР. '
  'Защита от двойной рассылки; сбрасывается естественно сменой ДР через '
  'trg_profiles_birth_date (поле birth_date_set_at).';

comment on column public.profiles.birthday_colleagues_notified_year is
  'Год, за который коллегам уже отправлен heads-up о приближающемся ДР '
  'этого юзера. См. profile.birthday_self_notified_year — то же поведение.';

-- ── claim_birthday_self_targets ─────────────────────────────────
-- Атомарно «забирает» именинников этого дня и возвращает их id+имя.
-- Cron потом генерит AI-текст и вставляет одно уведомление каждому.

create or replace function public.claim_birthday_self_targets()
returns table (
  user_id    uuid,
  first_name text,
  last_name  text
)
language sql security definer set search_path = public
as $$
  with today_msk as (
    select (now() at time zone 'Europe/Moscow')::date as d
  ),
  cur_year as (
    select extract(year from d)::smallint as y from today_msk
  )
  update public.profiles p
     set birthday_self_notified_year = (select y from cur_year)
   where p.birth_date is not null
     and to_char(p.birth_date, 'MM-DD') =
         to_char((select d from today_msk), 'MM-DD')
     and (
       p.birthday_self_notified_year is null
       or p.birthday_self_notified_year <> (select y from cur_year)
     )
     and exists (
       select 1 from public.user_venue_roles uvr
       where uvr.user_id = p.id and uvr.status = 'active'
     )
  returning p.id, p.first_name, p.last_name;
$$;

revoke all on function public.claim_birthday_self_targets() from public;
grant execute on function public.claim_birthday_self_targets() to service_role;

-- ── claim_birthday_colleague_targets ────────────────────────────
-- Атомарно «забирает» именинников через 7 дней и одним JOIN'ом
-- собирает список коллег (active members тех же venues).

create or replace function public.claim_birthday_colleague_targets()
returns table (
  birthday_user_id   uuid,
  first_name         text,
  last_name          text,
  birth_date         date,
  colleague_user_ids uuid[]
)
language sql security definer set search_path = public
as $$
  with target_msk as (
    select (now() at time zone 'Europe/Moscow')::date + interval '7 days' as d
  ),
  cur_year as (
    select extract(year from (now() at time zone 'Europe/Moscow')::date)::smallint as y
  ),
  claimed as (
    update public.profiles p
       set birthday_colleagues_notified_year = (select y from cur_year)
     where p.birth_date is not null
       and to_char(p.birth_date, 'MM-DD') =
           to_char((select d::date from target_msk), 'MM-DD')
       and (
         p.birthday_colleagues_notified_year is null
         or p.birthday_colleagues_notified_year <> (select y from cur_year)
       )
       and exists (
         select 1 from public.user_venue_roles uvr
         where uvr.user_id = p.id and uvr.status = 'active'
       )
    returning p.id, p.first_name, p.last_name, p.birth_date
  )
  select
    c.id as birthday_user_id,
    c.first_name,
    c.last_name,
    c.birth_date,
    coalesce(
      array_agg(distinct other_uvr.user_id)
        filter (where other_uvr.user_id is not null and other_uvr.user_id <> c.id),
      '{}'::uuid[]
    ) as colleague_user_ids
  from claimed c
  left join public.user_venue_roles birthday_uvr
    on birthday_uvr.user_id = c.id
   and birthday_uvr.status  = 'active'
  left join public.user_venue_roles other_uvr
    on other_uvr.venue_id = birthday_uvr.venue_id
   and other_uvr.status   = 'active'
  group by c.id, c.first_name, c.last_name, c.birth_date;
$$;

revoke all on function public.claim_birthday_colleague_targets() from public;
grant execute on function public.claim_birthday_colleague_targets() to service_role;
