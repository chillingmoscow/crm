\set ON_ERROR_STOP on
-- Миграция 360: телефон, Telegram, дату рождения и адрес из profiles нельзя
-- прочитать через API (anon/authenticated), остальные колонки — можно.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select ('c0a80000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'profiles-pd-qa-'||n||'@example.com',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
from generate_series(1,2)n;
insert into public.accounts(id,name,owner_id) values
 ('c0a80000-0000-4000-8001-000000000001','Profiles PD QA','c0a80000-0000-4000-8000-000000000001');
insert into public.venues(id,account_id,name,timezone) values
 ('c0a80000-0000-4000-8002-000000000001','c0a80000-0000-4000-8001-000000000001','Profiles PD venue','Europe/Moscow');
insert into public.roles(id,venue_id,name,code) values
 ('c0a80000-0000-4000-8003-000000000001','c0a80000-0000-4000-8002-000000000001','Profiles PD barista','pd_qa_barista');
-- Строки коллег в profiles видит тот, кто видит их user_venue_roles, то есть
-- с people.view_staff. Утечка была у роли «список сотрудников есть, права на
-- личные данные нет» — её и проверяем.
delete from public.role_permissions where role_id='c0a80000-0000-4000-8003-000000000001';
insert into public.role_permissions(role_id,permission_id,granted)
select 'c0a80000-0000-4000-8003-000000000001',id,true from public.permissions where code='people.view_staff';
insert into public.user_venue_roles(user_id,venue_id,role_id,status)
select ('c0a80000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c0a80000-0000-4000-8002-000000000001',
 'c0a80000-0000-4000-8003-000000000001','active' from generate_series(1,2)n;
update public.profiles set active_venue_id='c0a80000-0000-4000-8002-000000000001',
 first_name='QA'||right(id::text,1),phone='+7900000000'||right(id::text,1),telegram_id='@qa',
 birth_date='1990-01-01',address='Москва',gender='male'
where id::text like 'c0a80000-0000-4000-8000-%';

set local role authenticated;
select set_config('request.jwt.claim.sub','c0a80000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
do $$
declare col text; n int;
begin
  -- Имя, аватар, пол коллеги по-прежнему видны (график, журналы, база знаний).
  select count(*) into n from public.profiles
  where id='c0a80000-0000-4000-8000-000000000002' and first_name='QA2' and gender='male' and avatar_url is null;
  if n<>1 then raise exception 'Colleague name/avatar/gender must stay readable';end if;
  -- Контакты — ни у коллеги, ни у себя (свои сервер читает admin-клиентом).
  foreach col in array array['phone','telegram_id','birth_date','address'] loop
    begin
      execute format('select %I from public.profiles where id=%L',col,'c0a80000-0000-4000-8000-000000000002');
      raise exception 'Colleague % is readable',col;
    exception when insufficient_privilege then null;end;
  end loop;
  begin
    perform p.* from public.profiles p where p.id='c0a80000-0000-4000-8000-000000000002';
    raise exception 'select * on profiles must not expose contacts';
  exception when insufficient_privilege then null;end;
  -- Запись своих контактов работает (страница «Профиль»), в т.ч. с возвратом id.
  update public.profiles set phone='+79001112233',telegram_id='@qa1',address='Тверь'
  where id='c0a80000-0000-4000-8000-000000000001';
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Own contacts update lost';end if;
end $$;
reset role;

do $$
declare col record;
begin
  if (select phone from public.profiles where id='c0a80000-0000-4000-8000-000000000001')<>'+79001112233'
  then raise exception 'Own phone was not saved';end if;
  for col in select column_name from information_schema.columns where table_schema='public' and table_name='profiles' loop
    if has_column_privilege('authenticated','public.profiles',col.column_name,'SELECT')
       = (col.column_name = any(array['phone','telegram_id','birth_date','address']))
    then raise exception 'Wrong authenticated SELECT on profiles.%',col.column_name;end if;
    if has_column_privilege('anon','public.profiles',col.column_name,'SELECT')
       = (col.column_name = any(array['phone','telegram_id','birth_date','address']))
    then raise exception 'Wrong anon SELECT on profiles.%',col.column_name;end if;
    if not has_column_privilege('service_role','public.profiles',col.column_name,'SELECT')
    then raise exception 'service_role lost profiles.%',col.column_name;end if;
  end loop;
  if not has_column_privilege('authenticated','public.profiles','phone','UPDATE') then raise exception 'Contacts became read-only';end if;
end $$;
rollback;
\echo Profiles: colleague contacts are not readable through the API, names and avatars are
