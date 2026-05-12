-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 135_medical_book_expiry_notifications.sql
--
-- Adds the schema bits needed for medbook-expiry reminders:
--   * get_venue_staff now returns medical_book_date so the staff list can
--     render an «expiring» / «expired» badge without a separate RPC round-trip.
--   * staff_account_details.medical_book_expiry_notified_for tracks the
--     medbook_date for which we have already emitted a notification — keeps
--     the daily cron idempotent and re-arms when HR refreshes the date.
--   * enqueue_medical_book_expiry_notifications() — the daily worker that
--     inserts one «staff.medical_book_expiring» notification per affected
--     user (only if not yet notified for the current medbook_date AND
--     medbook expires within 30 days OR is already past).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.staff_account_details
  add column if not exists medical_book_expiry_notified_for date;

comment on column public.staff_account_details.medical_book_expiry_notified_for is
  'Last medical_book_date for which an expiry notification has been emitted. '
  'Reset to NULL when the field is cleared; resets implicitly when '
  'medical_book_date changes (the worker compares it against the current value).';

-- ── get_venue_staff: expose medical_book_date ─────────────────
drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id             uuid,
  user_id            uuid,
  role_id            uuid,
  role_name          text,
  role_code          text,
  first_name         text,
  last_name          text,
  email              text,
  email_confirmed    boolean,
  avatar_url         text,
  phone              text,
  telegram_id        text,
  gender             text,
  birth_date         date,
  employment_date    date,
  medical_book_date  date,
  joined_at          timestamptz
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
    (au.email_confirmed_at is not null)                             as email_confirmed,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    sad.medical_book_date                                           as medical_book_date,
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
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;

grant execute on function public.get_venue_staff(uuid) to authenticated;

-- ── Daily worker: enqueue medbook-expiry notifications ────────
-- Targets staff whose medical_book_date is non-null AND (already expired
-- OR expires within 30 days) AND we haven't notified for this exact date.
--
-- Concurrency: claim-via-UPDATE ... RETURNING is atomic — overlapping cron
-- invocations (retry while previous run is still finishing) will not
-- double-emit. The UPDATE acquires row locks; the second concurrent
-- transaction blocks until the first commits, then re-evaluates the
-- WHERE clause and sees `medical_book_expiry_notified_for = medical_book_date`
-- — so it skips the row. Notification INSERT happens only for rows that
-- this transaction successfully claimed.
create or replace function public.enqueue_medical_book_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  r record;
  v_days_left integer;
  v_title text;
  v_body  text;
begin
  for r in
    update public.staff_account_details sad
       set medical_book_expiry_notified_for = sad.medical_book_date
     where sad.medical_book_date is not null
       and sad.medical_book_date <= current_date + interval '30 days'
       and (
         sad.medical_book_expiry_notified_for is null
         or sad.medical_book_expiry_notified_for <> sad.medical_book_date
       )
       -- Only notify users who still hold an active role somewhere in the
       -- same account — no point pinging fully-exited staff.
       and exists (
         select 1
         from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id  = sad.user_id
           and uvr.status   = 'active'
           and v.account_id = sad.account_id
       )
     returning sad.account_id, sad.user_id, sad.medical_book_date
  loop
    v_days_left := (r.medical_book_date - current_date)::integer;
    if v_days_left < 0 then
      v_title := 'Медкнижка просрочена';
      v_body  := 'Срок действия медкнижки истёк ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 '. Пройдите медосмотр и обновите дату в профиле.';
    elsif v_days_left = 0 then
      v_title := 'Сегодня истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается сегодня. ' ||
                 'Пройдите медосмотр и обновите дату в профиле.';
    else
      v_title := 'Скоро истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 ' (через ' || v_days_left || ' дн.). Запланируйте медосмотр.';
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      r.user_id,
      'staff.medical_book_expiring',
      v_title,
      v_body,
      '/profile'
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_medical_book_expiry_notifications() from public;
grant execute on function public.enqueue_medical_book_expiry_notifications() to service_role;
