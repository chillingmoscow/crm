-- Обязательное чтение: правка не сбрасывает прочтение, перечитывание —
-- только по кнопке менеджера, «Напомнить» не чаще раза в сутки
-- (миграция 416). Синтетические данные, всё откатывается.
--
--   pnpm db:reset
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -f - \
--     < supabase/tests/kb-reading-state.sql
\set ON_ERROR_STOP on
begin;

-- ── Данные: менеджер (владелец), три читателя, обязательная страница ──
do $$
declare owner_id uuid; v uuid; a uuid; r uuid; p uuid;
  reader uuid := gen_random_uuid();
  fired uuid := gen_random_uuid();
  idle uuid := gen_random_uuid();
begin
  select id into owner_id from auth.users where email = 'owner@test.com';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('app.ctx_ready', '0', true);
  v := public.get_active_venue_id();
  a := public.get_active_account_id();
  if owner_id is null or a is null or v is null then raise exception 'Нет владельца из seed'; end if;
  if not public.has_permission('kb.manage_required_reading') then
    raise exception 'У владельца нет kb.manage_required_reading';
  end if;

  insert into public.roles(venue_id, name, code) values (v, 'KB reader QA', 'kb_reader_qa') returning id into r;
  insert into public.role_permissions(role_id, permission_id, granted)
    select r, id, true from public.permissions where code = 'kb.view_pages';
  insert into auth.users(id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    select id, 'authenticated', 'authenticated', 'kb-qa-' || id || '@qa.invalid', '{}', '{}', now(), now()
    from unnest(array[reader, fired, idle]) id;
  insert into public.profiles(id, first_name, active_venue_id)
    select id, 'QA', v from unnest(array[reader, fired, idle]) id
    on conflict (id) do update set active_venue_id = v;
  insert into public.user_venue_roles(user_id, venue_id, role_id, status)
    select id, v, r, 'active' from unnest(array[reader, fired, idle]) id;
  update public.user_venue_roles set fired_at = now() where user_id = fired;

  insert into public.kb_pages(account_id, title, slug, required_reading)
    values (a, 'QA обязательная', 'qa-required-' || substr(md5(random()::text), 1, 8), true)
    returning id into p;
  insert into public.kb_page_versions(page_id, account_id, version_number, title, content)
    values (p, a, 1, 'QA обязательная', '[]');
  insert into public.kb_page_reads(user_id, page_id, account_id, read_version)
    values (reader, p, a, 1);
  -- Автор поправил страницу после прочтения.
  insert into public.kb_page_versions(page_id, account_id, version_number, title, content)
    values (p, a, 2, 'QA обязательная', '[]');

  perform set_config('qa.kb_owner', owner_id::text, true);
  perform set_config('qa.kb_account', a::text, true);
  perform set_config('qa.kb_page', p::text, true);
  perform set_config('qa.kb_reader', reader::text, true);
  perform set_config('qa.kb_fired', fired::text, true);
  perform set_config('qa.kb_idle', idle::text, true);
end $$;

set local role authenticated;

-- ── 1. Правка не сбрасывает прочтение ──
select set_config('request.jwt.claim.sub', current_setting('qa.kb_reader'), true), set_config('app.ctx_ready', '0', true);
do $$ declare d jsonb := public.kb_get_page_view_data(current_setting('qa.kb_page')::uuid);
begin
  if (d->>'needs_reread')::boolean then raise exception 'Правка сбросила прочтение'; end if;
  if d->>'my_read_at' is null then raise exception 'Прочтение до правки не засчитано'; end if;
end $$;

-- ── 2. Менеджер видит «изменена после прочтения» и просит перечитать ──
select set_config('request.jwt.claim.sub', current_setting('qa.kb_owner'), true), set_config('app.ctx_ready', '0', true);
do $$ declare o record; n integer;
begin
  select * into o from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid);
  if o.page_id is null then raise exception 'Нет строки обзора для страницы'; end if;
  if not o.changed_after_read then raise exception 'Не видно правки после прочтения'; end if;
  if o.stale_count <> 1 then raise exception 'Сбросить должны 1 человека, а не %', o.stale_count; end if;
  if o.read_count <> 1 or o.current_version <> 2 then raise exception 'Неверный счёт: % из %, версия %', o.read_count, o.total, o.current_version; end if;
  -- Вызывать отозванную функцию под `set local role` из psql нельзя:
  -- локальный Postgres падает с segfault (через PostgREST — обычная 42501).
  -- Доступ к составу проверяется has_function_privilege в разделе 6.
end $$;
do $$ declare n integer;
begin
  n := public.kb_request_reread(current_setting('qa.kb_page')::uuid);
  if n <> 1 then raise exception 'Попросить перечитать уведомило %, ждали 1', n; end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('qa.kb_reader'), true), set_config('app.ctx_ready', '0', true);
do $$ declare d jsonb := public.kb_get_page_view_data(current_setting('qa.kb_page')::uuid);
begin
  if not (d->>'needs_reread')::boolean then raise exception 'После просьбы прочтение не сброшено'; end if;
  if d->>'my_read_at' is not null then raise exception 'Старое прочтение всё ещё действует'; end if;
end $$;

reset role;
do $$ begin
  if (select count(*) from public.notifications
       where type = 'kb.reread_requested' and entity_id = current_setting('qa.kb_page')::uuid
         and user_id = current_setting('qa.kb_reader')::uuid) <> 1 then
    raise exception 'Читатель не получил уведомление о перечитывании';
  end if;
  if exists (select 1 from public.notifications
       where type = 'kb.reread_requested' and entity_id = current_setting('qa.kb_page')::uuid
         and user_id = current_setting('qa.kb_owner')::uuid) then
    raise exception 'Менеджер уведомил сам себя';
  end if;
  if not exists (select 1 from public.audit_logs
       where action_code = 'kb_page.reread_requested' and entity_id = current_setting('qa.kb_page')::uuid) then
    raise exception 'Нет записи в журнале о перечитывании';
  end if;
  -- Читатель перечитал версию 2, потом страницу снова поправили.
  insert into public.kb_page_reads(user_id, page_id, account_id, read_version)
    values (current_setting('qa.kb_reader')::uuid, current_setting('qa.kb_page')::uuid, current_setting('qa.kb_account')::uuid, 2);
  insert into public.kb_page_versions(page_id, account_id, version_number, title, content)
    values (current_setting('qa.kb_page')::uuid, current_setting('qa.kb_account')::uuid, 3, 'QA обязательная', '[]');
end $$;

-- ── 3. «Не нужно» прячет правку до следующей версии ──
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.kb_owner'), true), set_config('app.ctx_ready', '0', true);
do $$ declare o record;
begin
  select * into o from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid);
  if not o.changed_after_read then raise exception 'Правка после перечитывания не видна'; end if;
  perform public.kb_dismiss_reread(current_setting('qa.kb_page')::uuid);
  select * into o from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid);
  if o.changed_after_read then raise exception '«Не нужно» не спрятало правку'; end if;
end $$;
reset role;
insert into public.kb_page_versions(page_id, account_id, version_number, title, content)
  select current_setting('qa.kb_page')::uuid, current_setting('qa.kb_account')::uuid, 4, 'QA обязательная', '[]';
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.kb_owner'), true), set_config('app.ctx_ready', '0', true);
do $$ declare o record;
begin
  select * into o from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid);
  if not o.changed_after_read then raise exception 'Новая правка после «Не нужно» не видна'; end if;
end $$;

-- ── 4. «Напомнить»: только непрочитавшим, без уволенных и автора, раз в сутки ──
do $$ declare n integer; expected integer; o record;
begin
  select * into o from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid);
  n := public.kb_remind_unread(current_setting('qa.kb_page')::uuid);
  -- Непрочитавшие из состава минус сам менеджер (он тоже в составе и не читал).
  expected := o.unread_count + o.reread_count - 1;
  if n <> expected then raise exception '«Напомнить» уведомило %, ждали %', n, expected; end if;
  begin
    perform public.kb_remind_unread(current_setting('qa.kb_page')::uuid);
    raise exception 'Второе напоминание за сутки прошло';
  exception when raise_exception then
    if sqlerrm <> 'Напоминание по этой странице уже отправляли за последние сутки' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.notifications where type = 'kb.required_reading_reminder'
       and entity_id = current_setting('qa.kb_page')::uuid and user_id = current_setting('qa.kb_idle')::uuid) then
    raise exception 'Непрочитавший не получил напоминание';
  end if;
  if exists (select 1 from public.notifications where type = 'kb.required_reading_reminder'
       and entity_id = current_setting('qa.kb_page')::uuid
       and user_id in (current_setting('qa.kb_fired')::uuid, current_setting('qa.kb_owner')::uuid, current_setting('qa.kb_reader')::uuid)) then
    raise exception 'Напоминание ушло уволенному, менеджеру или прочитавшему';
  end if;
  if not exists (select 1 from public.audit_logs where action_code = 'kb_page.reminder_sent'
       and entity_id = current_setting('qa.kb_page')::uuid) then
    raise exception 'Нет записи в журнале о напоминании';
  end if;
end $$;

-- ── 5. Без права — отказ, состояние не меняется ──
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('qa.kb_idle'), true), set_config('app.ctx_ready', '0', true);
do $$ declare before jsonb; after jsonb;
begin
  select to_jsonb(s) into before from public.kb_page_reading_state s where page_id = current_setting('qa.kb_page')::uuid;
  begin
    perform public.kb_request_reread(current_setting('qa.kb_page')::uuid);
    raise exception 'Сотрудник без права попросил перечитать';
  exception when raise_exception then
    if sqlerrm <> 'Нет права управлять обязательным чтением' then raise; end if;
  end;
  begin
    perform public.kb_remind_unread(current_setting('qa.kb_page')::uuid);
    raise exception 'Сотрудник без права отправил напоминание';
  exception when raise_exception then
    if sqlerrm <> 'Нет права управлять обязательным чтением' then raise; end if;
  end;
  if exists (select 1 from public.kb_required_reading_overview(current_setting('qa.kb_page')::uuid)) then
    raise exception 'Обзор отдаётся без права';
  end if;
  select to_jsonb(s) into after from public.kb_page_reading_state s where page_id = current_setting('qa.kb_page')::uuid;
  if before is distinct from after then raise exception 'Состояние изменилось без права'; end if;
end $$;
reset role;

-- ── 6. Права на функции ──
do $$ begin
  if has_function_privilege('anon', 'public.kb_remind_unread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_request_reread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_dismiss_reread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_required_reading_overview(uuid)', 'execute') then
    raise exception 'Функции обязательного чтения доступны анониму';
  end if;
  if has_function_privilege('authenticated', 'public.kb_required_reading_roster(uuid)', 'execute') then
    raise exception 'Состав доступен пользователю напрямую';
  end if;
  raise notice 'PASS: правка не сбрасывает прочтение, перечитывание по кнопке, «Не нужно», напоминание раз в сутки, права';
end $$;

rollback;
