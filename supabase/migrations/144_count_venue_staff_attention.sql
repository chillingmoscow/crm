-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 144_count_venue_staff_attention.sql
--
-- RPC для бейджа на пункте «Сотрудники» в сайдбаре. Возвращает количество
-- активных сотрудников venue, у которых сейчас «висит» событие, требующее
-- внимания админа:
--   • ДР сегодня или в ближайшие 7 дней (сравниваем month-day);
--   • медкнижка просрочена ИЛИ истекает в ближайшие 30 дней.
--
-- Условия 1-в-1 совпадают с теми, что рисуют бейджи в строке списка
-- (staff-client.tsx — medbookStatus / birthdayStatus). Если эти условия
-- разъедутся — циферка в сайдбаре перестанет совпадать с тем, что видит
-- админ в списке (UX-bug). Если правишь это здесь — поправь и там.
--
-- Timezone: prod-DB session обычно в UTC, а юзеры в Москве (UTC+3) и
-- ниже по DST'у. Если использовать просто `current_date`, около полуночи
-- по Москве RPC ещё думает что вчера, а UI (new Date() в браузере) уже
-- сегодня — разъезд бейджа в строке и циферки в сайдбаре на один день.
-- Считаем «сегодня» в MSK явным timezone-конверсией. Это нормально пока
-- мы работаем только в России; когда выйдем в другие тайм-зоны — нужно
-- будет пробросить юзерскую TZ из браузера в RPC аргументом.
--
-- 29 февраля: в не-високосный год не матчится (admin'у не показываем
-- ложный бейдж в день, которого нет). UI в JS считает Mar 1 как ДР для
-- Feb-29-юзеров — это расхождение в один день в не-високосный год, пока
-- допустимо.
--
-- security definer: вызов идёт из dashboard layout под обычным юзером,
-- а под капотом нужно прочитать profiles и staff_account_details других
-- сотрудников. Каркасный гард — caller должен быть активным членом
-- этого venue (как в get_venue_staff).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.count_venue_staff_attention(p_venue_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with msk_today as (
    -- «Сегодня» в Москве (UTC+3). См. timezone-комментарий в header'е.
    select (now() at time zone 'Europe/Moscow')::date as d
  )
  select count(*)::integer
  from public.user_venue_roles uvr
  join public.profiles p on p.id = uvr.user_id
  join public.venues   v on v.id = uvr.venue_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
  cross join msk_today
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
    and (
      -- ДР в ближайшие 7 дней (включая сегодня) — сравниваем MM-DD.
      (
        p.birth_date is not null
        and exists (
          select 1
          from generate_series(0, 7) as d
          where to_char(p.birth_date, 'MM-DD')
              = to_char(msk_today.d + (d || ' days')::interval, 'MM-DD')
        )
      )
      or
      -- Медкнижка просрочена или истекает в ближайшие 30 дней.
      (
        sad.medical_book_date is not null
        and sad.medical_book_date <= msk_today.d + interval '30 days'
      )
    );
$$;

grant execute on function public.count_venue_staff_attention(uuid) to authenticated;
