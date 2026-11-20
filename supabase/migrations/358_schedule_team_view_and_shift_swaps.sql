-- График: (1) опубликованное расписание всей команды видно каждому
-- сотруднику заведения; (2) замена смены с утверждением управляющим.
--
-- (1) Политику чтения schedule_shifts НЕ расширяем: строка смены несёт
-- заметку и поля оплаты. Сотруднику без schedule.view_all чужие
-- опубликованные смены отдаёт schedule_team_shifts() — только поля для
-- сетки (кто, когда, должность, подразделение, название, цвет). Свои смены
-- он по-прежнему читает из таблицы целиком. schedule.view_all теперь
-- означает «планирование»: черновики, служебные данные, история.
--
-- (2) schedule_shift_swaps — заявка «вместо меня выйдет коллега». Пишется
-- только через schedule_swap_command(). Ответ коллеги необязателен:
-- управляющий (schedule.shift_assign) утверждает или отклоняет в любой
-- момент. Утверждение меняет user_id смены в той же транзакции — зарплата
-- и сверка отметок берут сотрудника из смены, отдельной привязки нет.
-- Правило «кто подходит» продублировано в src/lib/schedule/shift-swaps.ts
-- (список кандидатов + тесты); здесь — окончательная проверка.
begin;

update public.permissions
   set description = 'Планирование графика: черновики, кандидаты, история и служебные данные смен'
 where code = 'schedule.view_all';

-- ── (1) Общий график ────────────────────────────────────────────────────────

create or replace function public.schedule_team_shifts(p_from timestamptz default null, p_to timestamptz default null)
returns table(
  id uuid, user_id uuid, casual_id uuid, casual_name text, casual_role_name text,
  role_id uuid, department_id uuid, title text, color text,
  starts_at timestamptz, ends_at timestamptz, version integer, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select s.id, s.user_id, s.payroll_employee_id, e.name, e.role_name,
         s.role_id, s.department_id, s.title, s.color,
         s.starts_at, s.ends_at, s.version, s.updated_at
    from public.schedule_shifts s
    left join public.payroll_employees e
      on e.venue_id = s.venue_id and e.id = s.payroll_employee_id
   where s.venue_id = public.get_active_venue_id()
     and s.published
     and (p_from is null or s.ends_at >= p_from)
     and (p_to is null or s.starts_at <= p_to)
     and exists (
       select 1 from public.user_venue_roles uvr
        where uvr.user_id = (select auth.uid())
          and uvr.venue_id = s.venue_id
          and uvr.status = 'active'
     )
   order by s.starts_at, s.id
$$;
revoke all on function public.schedule_team_shifts(timestamptz, timestamptz) from public, anon;
grant execute on function public.schedule_team_shifts(timestamptz, timestamptz) to authenticated;

-- Названия подразделений для сетки и фильтра: таблица departments читается
-- только с people.view_roles.
create or replace function public.schedule_team_departments()
returns table(id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select d.id, d.name
    from public.departments d
   where d.venue_id = public.get_active_venue_id()
     and d.archived_at is null
     and exists (
       select 1 from public.user_venue_roles uvr
        where uvr.user_id = (select auth.uid())
          and uvr.venue_id = d.venue_id
          and uvr.status = 'active'
     )
   order by d.name
$$;
revoke all on function public.schedule_team_departments() from public, anon;
grant execute on function public.schedule_team_departments() to authenticated;

-- ── (2) Заявки на замену ────────────────────────────────────────────────────

create table public.schedule_shift_swaps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id),
  to_user_id uuid not null references public.profiles(id),
  comment text not null default '' check (length(comment) <= 500),
  -- pending — ждёт решения; approved/rejected — решение управляющего;
  -- cancelled — отозвал автор; voided — смену изменили в обход заявки.
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'voided')),
  candidate_answer text check (candidate_answer in ('accepted', 'declined')),
  candidate_answered_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_comment text not null default '' check (length(decision_comment) <= 500),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, venue_id) references public.venues(account_id, id) on delete cascade,
  check (from_user_id <> to_user_id),
  check ((candidate_answer is null) = (candidate_answered_at is null)),
  check ((status = 'pending') = (decided_at is null))
);
create unique index schedule_shift_swaps_one_pending
  on public.schedule_shift_swaps(shift_id) where status = 'pending';
create index schedule_shift_swaps_venue
  on public.schedule_shift_swaps(account_id, venue_id, status);
create index schedule_shift_swaps_shift on public.schedule_shift_swaps(shift_id);
create index schedule_shift_swaps_from on public.schedule_shift_swaps(from_user_id);
create index schedule_shift_swaps_to on public.schedule_shift_swaps(to_user_id);
create index schedule_shift_swaps_decided_by on public.schedule_shift_swaps(decided_by);

alter table public.schedule_shift_swaps enable row level security;
revoke all on public.schedule_shift_swaps from public, anon, authenticated;
grant select on public.schedule_shift_swaps to authenticated;
create policy schedule_shift_swaps_read on public.schedule_shift_swaps
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
      or (select public.has_permission('schedule.shift_assign'))
    )
  );

-- Почему сотрудник не может взять смену; null — подходит.
-- Та же должность или допуск, активен в заведении, в этот день свободен.
create or replace function private.schedule_swap_problem(p_shift public.schedule_shifts, p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  tz text;
  shift_day date;
begin
  if p_user is null then return 'Выберите сотрудника'; end if;
  if p_user is not distinct from p_shift.user_id then return 'Сотрудник уже стоит на этой смене'; end if;
  if not exists (
    select 1 from public.user_venue_roles
     where user_id = p_user and venue_id = p_shift.venue_id and status = 'active'
  ) then
    return 'Сотрудник не работает в заведении';
  end if;
  if p_shift.role_id is not null
     and not exists (
       select 1 from public.user_venue_roles
        where user_id = p_user and venue_id = p_shift.venue_id
          and status = 'active' and role_id = p_shift.role_id
     )
     and not exists (
       select 1 from public.schedule_qualifications
        where user_id = p_user and venue_id = p_shift.venue_id and role_id = p_shift.role_id
     ) then
    return 'У сотрудника нет допуска к этой позиции';
  end if;
  select coalesce(v.timezone, 'Europe/Moscow') into tz from public.venues v where v.id = p_shift.venue_id;
  shift_day := (p_shift.starts_at at time zone tz)::date;
  if exists (
    select 1 from public.schedule_shifts o
     where o.user_id = p_user and o.id <> p_shift.id
       and (
         (o.starts_at < p_shift.ends_at and o.ends_at > p_shift.starts_at)
         or (o.starts_at at time zone tz)::date = shift_day
       )
  ) then
    return 'У сотрудника уже есть смена в этот день';
  end if;
  return null;
end
$$;
revoke all on function private.schedule_swap_problem(public.schedule_shifts, uuid) from public, anon, authenticated;

-- «21.11, 10:00–22:00 · Бар» для текстов уведомлений.
create or replace function private.schedule_shift_span(p_shift public.schedule_shifts)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select to_char(p_shift.starts_at at time zone tz, 'DD.MM') || ', '
      || to_char(p_shift.starts_at at time zone tz, 'HH24:MI') || '–'
      || to_char(p_shift.ends_at at time zone tz, 'HH24:MI') || ' · ' || p_shift.title
    from (select coalesce((select timezone from public.venues where id = p_shift.venue_id), 'Europe/Moscow') as tz) z
$$;
revoke all on function private.schedule_shift_span(public.schedule_shifts) from public, anon, authenticated;

create or replace function private.schedule_swap_notify(
  p_swap public.schedule_shift_swaps,
  p_shift public.schedule_shifts,
  p_recipient uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  tz text;
  shift_day date;
begin
  if p_recipient is null or p_recipient = (select auth.uid()) then return; end if;
  select coalesce(v.timezone, 'Europe/Moscow') into tz from public.venues v where v.id = p_shift.venue_id;
  shift_day := (p_shift.starts_at at time zone tz)::date;
  insert into public.notifications(user_id, venue_id, type, category, title, body, link,
                                   actor_user_id, entity_type, entity_id, payload)
  values (p_recipient, p_shift.venue_id, p_type, 'schedule', p_title, p_body,
          '/schedule?date=' || shift_day || '&swap=' || p_swap.id,
          (select auth.uid()), 'schedule_shift_swap', p_swap.id,
          jsonb_build_object('date', shift_day, 'shift_id', p_shift.id, 'preview_kind', 'generic'));
end
$$;
revoke all on function private.schedule_swap_notify(public.schedule_shift_swaps, public.schedule_shifts, uuid, text, text, text)
  from public, anon, authenticated;

create or replace function public.schedule_swap_command(p_action text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  u uuid := (select auth.uid());
  v uuid := public.get_active_venue_id();
  acc uuid;
  sh public.schedule_shifts;
  after_shift public.schedule_shifts;
  sw public.schedule_shift_swaps;
  problem text;
  span text;
  who_from text;
  who_to text;
  manager uuid;
begin
  if u is null or v is null or not exists (
    select 1 from public.user_venue_roles where user_id = u and venue_id = v and status = 'active'
  ) then
    raise exception 'Нет доступа к заведению';
  end if;
  select account_id into acc from public.venues where id = v;

  if p_action = 'request' then
    select * into sh from public.schedule_shifts
     where id = nullif(p_input->>'shift_id', '')::uuid and venue_id = v
     for update;
    if not found then raise exception 'Смена не найдена'; end if;
    if sh.user_id is distinct from u or not sh.published then
      raise exception 'Замену можно предложить только для своей опубликованной смены';
    end if;
    if sh.starts_at <= now() then raise exception 'Смена уже началась'; end if;
    if exists (select 1 from public.schedule_runs where shift_id = sh.id) then
      raise exception 'В смене уже начат чек-лист';
    end if;
    if exists (select 1 from public.schedule_shift_swaps where shift_id = sh.id and status = 'pending') then
      raise exception 'По этой смене уже есть заявка на замену';
    end if;
    problem := private.schedule_swap_problem(sh, nullif(p_input->>'to_user_id', '')::uuid);
    if problem is not null then raise exception '%', problem; end if;
    if length(coalesce(p_input->>'comment', '')) > 500 then raise exception 'Комментарий слишком длинный'; end if;

    insert into public.schedule_shift_swaps(account_id, venue_id, shift_id, from_user_id, to_user_id, comment)
    values (acc, v, sh.id, u, (p_input->>'to_user_id')::uuid, trim(coalesce(p_input->>'comment', '')))
    returning * into sw;

    span := private.schedule_shift_span(sh);
    who_from := private.schedule_person_name(u, null);
    who_to := private.schedule_person_name(sw.to_user_id, null);
    perform private.schedule_swap_notify(sw, sh, sw.to_user_id, 'schedule.swap_offered',
      who_from || ' предлагает вам свою смену',
      span || case when sw.comment <> '' then '. ' || sw.comment else '' end);
    for manager in
      select distinct uvr.user_id
        from public.user_venue_roles uvr
        join public.role_permissions rp on rp.role_id = uvr.role_id and rp.granted
        join public.permissions p on p.id = rp.permission_id and p.code = 'schedule.shift_assign'
       where uvr.venue_id = v and uvr.status = 'active'
         and uvr.user_id not in (sw.from_user_id, sw.to_user_id)
    loop
      perform private.schedule_swap_notify(sw, sh, manager, 'schedule.swap_requested',
        'Заявка на замену: ' || who_from || ' → ' || who_to, span);
    end loop;

  elsif p_action in ('cancel', 'respond', 'approve', 'reject') then
    select * into sw from public.schedule_shift_swaps
     where id = nullif(p_input->>'id', '')::uuid and venue_id = v and account_id = acc
     for update;
    if not found then raise exception 'Заявка не найдена'; end if;
    if sw.version <> coalesce((p_input->>'version')::integer, 0) then
      raise exception 'Заявка уже изменилась. Обновите страницу';
    end if;
    if sw.status <> 'pending' then raise exception 'По заявке уже принято решение'; end if;
    select * into sh from public.schedule_shifts where id = sw.shift_id for update;
    span := private.schedule_shift_span(sh);
    who_from := private.schedule_person_name(sw.from_user_id, null);
    who_to := private.schedule_person_name(sw.to_user_id, null);

    if p_action = 'cancel' then
      if sw.from_user_id <> u then raise exception 'Отозвать заявку может только её автор'; end if;
      update public.schedule_shift_swaps
         set status = 'cancelled', decided_at = now(), version = version + 1, updated_at = now()
       where id = sw.id returning * into sw;
      perform private.schedule_swap_notify(sw, sh, sw.to_user_id, 'schedule.swap_cancelled',
        who_from || ' отозвал(а) заявку на замену', span);

    elsif p_action = 'respond' then
      if sw.to_user_id <> u then raise exception 'Ответить может только тот, кому предложили смену'; end if;
      if coalesce(p_input->>'answer', '') not in ('accepted', 'declined') then
        raise exception 'Неверный ответ';
      end if;
      if sh.ends_at <= now() then raise exception 'Смена уже закончилась'; end if;
      update public.schedule_shift_swaps
         set candidate_answer = p_input->>'answer', candidate_answered_at = now(),
             version = version + 1, updated_at = now()
       where id = sw.id returning * into sw;
      perform private.schedule_swap_notify(sw, sh, sw.from_user_id, 'schedule.swap_answered',
        case when sw.candidate_answer = 'accepted'
             then who_to || ' согласен(на) выйти вместо вас'
             else who_to || ' не может выйти вместо вас' end,
        span || '. Решение — за управляющим');

    else
      if not public.has_permission('schedule.shift_assign') then
        raise exception 'Нет права назначать сотрудников на смены';
      end if;
      if p_action = 'reject' then
        if length(coalesce(p_input->>'comment', '')) > 500 then raise exception 'Комментарий слишком длинный'; end if;
        update public.schedule_shift_swaps
           set status = 'rejected', decided_by = u, decided_at = now(),
               decision_comment = trim(coalesce(p_input->>'comment', '')),
               version = version + 1, updated_at = now()
         where id = sw.id returning * into sw;
        perform private.schedule_swap_notify(sw, sh, sw.from_user_id, 'schedule.swap_rejected',
          'Замену не утвердили', span || ' остаётся за вами'
            || case when sw.decision_comment <> '' then '. ' || sw.decision_comment else '' end);
        perform private.schedule_swap_notify(sw, sh, sw.to_user_id, 'schedule.swap_rejected',
          'Замену не утвердили', span || ' остаётся за ' || who_from);
      else
        if sh.user_id is distinct from sw.from_user_id or not sh.published then
          raise exception 'Смену уже изменили — заявка неактуальна';
        end if;
        if sh.ends_at <= now() then raise exception 'Смена уже закончилась'; end if;
        if exists (select 1 from public.schedule_runs where shift_id = sh.id) then
          raise exception 'Нельзя переназначить начатую смену';
        end if;
        perform pg_advisory_xact_lock(hashtextextended(sw.to_user_id::text, 0));
        problem := private.schedule_swap_problem(sh, sw.to_user_id);
        if problem is not null then raise exception '%', problem; end if;

        -- Стандартные «вас сняли / поставили» (338) заменяем своими.
        perform set_config('app.schedule_swap', '1', true);
        update public.schedule_shifts
           set user_id = sw.to_user_id, version = version + 1, updated_at = now()
         where id = sh.id returning * into after_shift;
        perform set_config('app.schedule_swap', '', true);

        insert into public.schedule_events(venue_id, entity_id, actor_id, action, details)
        values (v, sh.id, u, 'shift.swap',
                jsonb_build_object('swap_id', sw.id, 'before', to_jsonb(sh), 'after', to_jsonb(after_shift)));
        update public.schedule_shift_swaps
           set status = 'approved', decided_by = u, decided_at = now(),
               version = version + 1, updated_at = now()
         where id = sw.id returning * into sw;
        perform private.schedule_swap_notify(sw, after_shift, sw.from_user_id, 'schedule.swap_approved',
          'Замена утверждена', span || '. Вместо вас выйдет ' || who_to);
        perform private.schedule_swap_notify(sw, after_shift, sw.to_user_id, 'schedule.swap_approved',
          'Вам передали смену', span || '. Вместо: ' || who_from);
      end if;
    end if;
  else
    raise exception 'Неизвестное действие';
  end if;

  return jsonb_build_object('id', sw.id, 'version', sw.version, 'status', sw.status);
end
$$;
revoke all on function public.schedule_swap_command(text, jsonb) from public, anon;
grant execute on function public.schedule_swap_command(text, jsonb) to authenticated;

-- Смену изменили в обход заявки (переназначили, перенесли, сменили
-- должность, сняли с публикации) — заявка теряет смысл.
create or replace function private.schedule_swap_void_on_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  sw public.schedule_shift_swaps;
begin
  if current_setting('app.schedule_swap', true) = '1' then return new; end if;
  if old.user_id is not distinct from new.user_id
     and old.payroll_employee_id is not distinct from new.payroll_employee_id
     and old.starts_at = new.starts_at and old.ends_at = new.ends_at
     and old.role_id is not distinct from new.role_id
     and old.published = new.published then
    return new;
  end if;
  for sw in
    update public.schedule_shift_swaps
       set status = 'voided', decided_at = now(), version = version + 1, updated_at = now()
     where shift_id = new.id and status = 'pending'
    returning *
  loop
    perform private.schedule_swap_notify(sw, new, sw.to_user_id, 'schedule.swap_cancelled',
      'Заявка на замену отменена', private.schedule_shift_span(new) || '. Смену изменили в графике');
    if new.user_id is not distinct from sw.from_user_id then
      perform private.schedule_swap_notify(sw, new, sw.from_user_id, 'schedule.swap_cancelled',
        'Заявка на замену отменена', private.schedule_shift_span(new) || '. Смену изменили в графике');
    end if;
  end loop;
  return new;
end
$$;
revoke all on function private.schedule_swap_void_on_change() from public, anon, authenticated;

drop trigger if exists schedule_shift_swap_void on public.schedule_shifts;
create trigger schedule_shift_swap_void
  after update of user_id, payroll_employee_id, starts_at, ends_at, role_id, published on public.schedule_shifts
  for each row execute function private.schedule_swap_void_on_change();

-- 338: при утверждённой замене уведомления шлёт schedule_swap_command.
create or replace function private.schedule_notify_replacement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid := (select auth.uid());
  tz text;
  shift_day date;
  span text;
  who_old text;
  who_new text;
  had_old boolean := old.user_id is not null or old.payroll_employee_id is not null;
begin
  if current_setting('app.schedule_swap', true) = '1' then
    return new;
  end if;
  if not (old.published and new.published) then
    return new;
  end if;
  if old.user_id is not distinct from new.user_id
     and old.payroll_employee_id is not distinct from new.payroll_employee_id then
    return new;
  end if;

  select v.timezone into tz from public.venues v where v.id = new.venue_id;
  tz := coalesce(tz, 'Europe/Moscow');
  shift_day := (new.starts_at at time zone tz)::date;
  span := to_char(new.starts_at at time zone tz, 'DD.MM') || ', '
       || to_char(new.starts_at at time zone tz, 'HH24:MI') || '–'
       || to_char(new.ends_at at time zone tz, 'HH24:MI') || ' · ' || new.title;
  who_old := private.schedule_person_name(old.user_id, old.payroll_employee_id);
  who_new := private.schedule_person_name(new.user_id, new.payroll_employee_id);

  if old.user_id is not null
     and old.user_id is distinct from new.user_id
     and old.user_id is distinct from actor then
    insert into public.notifications(user_id, venue_id, type, category, title, body, link,
                                     actor_user_id, entity_type, entity_id, payload)
    values (old.user_id, new.venue_id, 'schedule.shift_unassigned', 'schedule',
            'Вас сняли со смены',
            span || case when new.user_id is not null or new.payroll_employee_id is not null
                         then '. Вместо вас — ' || who_new else '' end,
            '/schedule?date=' || shift_day, actor, 'schedule_shift', new.id,
            jsonb_build_object('date', shift_day, 'replacement', who_new, 'preview_kind', 'generic'));
  end if;

  if new.user_id is not null
     and new.user_id is distinct from old.user_id
     and new.user_id is distinct from actor then
    insert into public.notifications(user_id, venue_id, type, category, title, body, link,
                                     actor_user_id, entity_type, entity_id, payload)
    values (new.user_id, new.venue_id, 'schedule.shift_assigned', 'schedule',
            'Вас поставили на смену',
            span || case when had_old then '. Вместо: ' || who_old else '' end,
            '/schedule?date=' || shift_day, actor, 'schedule_shift', new.id,
            jsonb_build_object('date', shift_day, 'replaced', case when had_old then who_old end,
                               'preview_kind', 'generic'));
  end if;

  return new;
end
$$;
revoke all on function private.schedule_notify_replacement() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
