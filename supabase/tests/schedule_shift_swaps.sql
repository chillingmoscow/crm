-- Local regression (миграция 358): общий график и замена смены с утверждением.
begin;
do $$
declare
  owner_id uuid; staff_id uuid; manager_id uuid; mate_id uuid; v uuid; waiter_role uuid;
  shift_id uuid; other_shift uuid; swap_id uuid; ver integer; denied boolean; body jsonb; n integer;
begin
  select id into owner_id from auth.users where email = 'owner@test.com';
  select id into staff_id from auth.users where email = 'waiter@test.com';
  select id into manager_id from auth.users where email = 'manager@test.com';
  select active_venue_id into v from public.profiles where id = owner_id;
  select role_id into waiter_role from public.user_venue_roles where user_id = staff_id and venue_id = v and status = 'active';
  if owner_id is null or staff_id is null or manager_id is null or v is null then
    raise exception 'Нужны локальные seed-пользователи';
  end if;

  -- Второй официант — тот, кто выйдет вместо.
  mate_id := gen_random_uuid();
  insert into auth.users(id, email, instance_id, aud, role) values (mate_id, 'swap-mate-' || mate_id || '@test.com', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.profiles(id, first_name, last_name, active_venue_id) values (mate_id, 'Кристина', 'Тест', v)
    on conflict (id) do update set first_name = 'Кристина', active_venue_id = v;
  insert into public.user_venue_roles(user_id, venue_id, role_id, status) values (mate_id, v, waiter_role, 'active');

  perform set_config('request.jwt.claim.sub', owner_id::text, true); perform set_config('app.ctx_ready', '0', true);
  body := jsonb_build_object('date', (current_date + 70)::text, 'start_time', '10:00', 'end_time', '22:00',
    'title', 'TEST Замена', 'color', 'blue', 'user_id', staff_id, 'role_id', waiter_role,
    'department_id', (select department_id from public.roles where id = waiter_role), 'checklist_ids', '[]'::jsonb, 'note', 'секрет управляющего');
  shift_id := (public.schedule_command('shift.create', body) ->> 'id')::uuid;
  select version into ver from public.schedule_shifts where id = shift_id;
  perform public.schedule_command('shift.publish', jsonb_build_object('id', shift_id, 'version', ver));
  -- Черновик второго — его сотрудник видеть не должен.
  other_shift := (public.schedule_command('shift.create', body || jsonb_build_object('user_id', mate_id, 'date', (current_date + 71)::text)) ->> 'id')::uuid;

  -- (1) Сотрудник видит опубликованное, но не черновики и не заметки.
  perform set_config('request.jwt.claim.sub', mate_id::text, true); perform set_config('app.ctx_ready', '0', true);
  if not exists (select 1 from public.schedule_team_shifts() where id = shift_id) then raise exception 'Чужая опубликованная смена не видна'; end if;
  if exists (select 1 from public.schedule_team_shifts() where id = other_shift) then raise exception 'Черновик виден сотруднику'; end if;
  if (select count(*) from public.schedule_team_departments()) = 0 then raise exception 'Подразделения не видны'; end if;

  -- (2) Заявка: только своя смена, только подходящий коллега.
  denied := false;
  begin perform public.schedule_swap_command('request', jsonb_build_object('shift_id', shift_id, 'to_user_id', mate_id));
  exception when others then denied := sqlerrm like 'Замену можно предложить только%'; end;
  if not denied then raise exception 'Чужую смену удалось отдать'; end if;

  perform set_config('request.jwt.claim.sub', staff_id::text, true); perform set_config('app.ctx_ready', '0', true);
  if not exists (select 1 from public.schedule_qualifications where user_id = manager_id and role_id = waiter_role) then
    denied := false;
    begin perform public.schedule_swap_command('request', jsonb_build_object('shift_id', shift_id, 'to_user_id', manager_id));
    exception when others then denied := sqlerrm = 'У сотрудника нет допуска к этой позиции'; end;
    if not denied then raise exception 'Замена без допуска прошла'; end if;
  end if;
  swap_id := (public.schedule_swap_command('request', jsonb_build_object('shift_id', shift_id, 'to_user_id', mate_id, 'comment', 'Заболел')) ->> 'id')::uuid;
  if not exists (select 1 from public.notifications where user_id = mate_id and type = 'schedule.swap_offered' and entity_id = swap_id) then
    raise exception 'Коллеге не пришло уведомление';
  end if;
  if not exists (select 1 from public.notifications where user_id = owner_id and type = 'schedule.swap_requested' and entity_id = swap_id) then
    raise exception 'Управляющему не пришло уведомление';
  end if;

  -- Ответ коллеги необязателен, но записывается.
  perform set_config('request.jwt.claim.sub', mate_id::text, true); perform set_config('app.ctx_ready', '0', true);
  perform public.schedule_swap_command('respond', jsonb_build_object('id', swap_id, 'version', 1, 'answer', 'accepted'));
  if (select candidate_answer from public.schedule_shift_swaps where id = swap_id) <> 'accepted' then raise exception 'Ответ не сохранился'; end if;
  denied := false;
  begin perform public.schedule_swap_command('approve', jsonb_build_object('id', swap_id, 'version', 2));
  exception when others then denied := sqlerrm like 'Нет права%'; end;
  if not denied then raise exception 'Сотрудник утвердил замену сам'; end if;

  -- Утверждение: смена переходит, журнал и уведомления, без дублей из 338.
  perform set_config('request.jwt.claim.sub', owner_id::text, true); perform set_config('app.ctx_ready', '0', true);
  perform public.schedule_swap_command('approve', jsonb_build_object('id', swap_id, 'version', 2));
  if (select user_id from public.schedule_shifts where id = shift_id) <> mate_id then raise exception 'Смена не перешла'; end if;
  if (select status from public.schedule_shift_swaps where id = swap_id) <> 'approved' then raise exception 'Статус не approved'; end if;
  if not exists (select 1 from public.schedule_events where entity_id = shift_id and action = 'shift.swap') then raise exception 'Нет записи в истории'; end if;
  select count(*) into n from public.notifications where entity_id = shift_id and type in ('schedule.shift_assigned', 'schedule.shift_unassigned');
  if n <> 0 then raise exception 'Дублирующие уведомления 338: %', n; end if;
  select count(*) into n from public.notifications where entity_id = swap_id and type = 'schedule.swap_approved';
  if n <> 2 then raise exception 'Ожидалось 2 уведомления об утверждении, есть %', n; end if;

  -- Заявку, по которой смену изменили в обход, отменяет триггер.
  perform set_config('request.jwt.claim.sub', mate_id::text, true); perform set_config('app.ctx_ready', '0', true);
  swap_id := (public.schedule_swap_command('request', jsonb_build_object('shift_id', shift_id, 'to_user_id', staff_id)) ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', owner_id::text, true); perform set_config('app.ctx_ready', '0', true);
  select version into ver from public.schedule_shifts where id = shift_id;
  perform public.schedule_command('shift.assign', jsonb_build_object('id', shift_id, 'version', ver, 'user_id', null));
  if (select status from public.schedule_shift_swaps where id = swap_id) <> 'voided' then raise exception 'Заявка не отменилась при правке смены'; end if;

  raise notice 'PASS: team view hides drafts; swap request/answer/approve/void; permissions enforced';
end $$;
rollback;
