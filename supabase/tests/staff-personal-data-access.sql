\set ON_ERROR_STOP on
-- Миграция 359: get_venue_staff / get_fired_staff отдают контакты, даты и
-- причину увольнения коллег только при people.view_staff + people.view_staff_details
-- в активном заведении. Остальным — имя, аватар, должность, подразделение.
begin;
-- 1 — менеджер с правом на детали, 2 — сотрудник только с view_staff,
-- 3 — коллега с заполненными данными, 4 — уволенный, 5 — с правом на детали,
-- но активным выбрано другое заведение, 6 — чужой (только второе заведение).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
select ('c0a70000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'staff-pd-qa-'||n||'@example.com',now(),'{}'::jsonb,'{}'::jsonb,now()-interval '1 year',now()
from generate_series(1,6)n;
insert into public.accounts(id,name,owner_id) values
 ('c0a70000-0000-4000-8001-000000000001','Staff PD QA','c0a70000-0000-4000-8000-000000000001');
insert into public.venues(id,account_id,name,timezone) values
 ('c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8001-000000000001','Staff PD venue','Europe/Moscow'),
 ('c0a70000-0000-4000-8002-000000000002','c0a70000-0000-4000-8001-000000000001','Staff PD other venue','Europe/Moscow');
insert into public.roles(id,venue_id,name,code) values
 ('c0a70000-0000-4000-8003-000000000001','c0a70000-0000-4000-8002-000000000001','PD QA manager','pd_qa_manager'),
 ('c0a70000-0000-4000-8003-000000000002','c0a70000-0000-4000-8002-000000000001','PD QA barista','pd_qa_barista'),
 ('c0a70000-0000-4000-8003-000000000003','c0a70000-0000-4000-8002-000000000002','PD QA manager 2','pd_qa_manager');
delete from public.role_permissions where role_id::text like 'c0a70000-0000-4000-8003-%';
insert into public.role_permissions(role_id,permission_id,granted)
select r.id,p.id,true
from (values
  ('c0a70000-0000-4000-8003-000000000001'::uuid,'people.view_staff'),
  ('c0a70000-0000-4000-8003-000000000001'::uuid,'people.view_staff_details'),
  ('c0a70000-0000-4000-8003-000000000002'::uuid,'people.view_staff'),
  ('c0a70000-0000-4000-8003-000000000003'::uuid,'people.view_staff'),
  ('c0a70000-0000-4000-8003-000000000003'::uuid,'people.view_staff_details')
) g(role_id,code)
join public.roles r on r.id=g.role_id
join public.permissions p on p.code=g.code;
insert into public.user_venue_roles(user_id,venue_id,role_id,status,fired_reason) values
 ('c0a70000-0000-4000-8000-000000000001','c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8003-000000000001','active',null),
 ('c0a70000-0000-4000-8000-000000000002','c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8003-000000000002','active',null),
 ('c0a70000-0000-4000-8000-000000000003','c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8003-000000000002','active',null),
 ('c0a70000-0000-4000-8000-000000000004','c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8003-000000000002','fired','Прогулы'),
 ('c0a70000-0000-4000-8000-000000000005','c0a70000-0000-4000-8002-000000000001','c0a70000-0000-4000-8003-000000000001','active',null),
 ('c0a70000-0000-4000-8000-000000000005','c0a70000-0000-4000-8002-000000000002','c0a70000-0000-4000-8003-000000000003','active',null),
 ('c0a70000-0000-4000-8000-000000000006','c0a70000-0000-4000-8002-000000000002','c0a70000-0000-4000-8003-000000000003','active',null);
update public.profiles set
  active_venue_id='c0a70000-0000-4000-8002-000000000001',
  first_name='QA'||right(id::text,1),
  phone='+7900000000'||right(id::text,1),
  telegram_id='@pd_qa_'||right(id::text,1),
  gender='female',
  birth_date='1995-05-05'
where id::text like 'c0a70000-0000-4000-8000-%';
update public.profiles set active_venue_id='c0a70000-0000-4000-8002-000000000002'
where id in ('c0a70000-0000-4000-8000-000000000005','c0a70000-0000-4000-8000-000000000006');
insert into public.staff_account_details(account_id,user_id,employment_date,medical_book_date) values
 ('c0a70000-0000-4000-8001-000000000001','c0a70000-0000-4000-8000-000000000003','2025-01-15','2027-01-01');

create temp table pd_qa_result(caller text,uvr_user uuid,row jsonb) on commit drop;
grant all on pd_qa_result to authenticated;

set local role authenticated;
-- Менеджер с правом на детали.
select set_config('request.jwt.claim.sub','c0a70000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
insert into pd_qa_result select 'manager',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
insert into pd_qa_result select 'manager_fired',s.user_id,to_jsonb(s) from public.get_fired_staff('c0a70000-0000-4000-8002-000000000001') s;
-- Сотрудник без права на детали.
select set_config('request.jwt.claim.sub','c0a70000-0000-4000-8000-000000000002',true),set_config('app.ctx_ready','0',true);
insert into pd_qa_result select 'barista',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
insert into pd_qa_result select 'barista_fired',s.user_id,to_jsonb(s) from public.get_fired_staff('c0a70000-0000-4000-8002-000000000001') s;
-- Тот же путь через кэш контекста сессии (миграция 237): права из app.perms.
select private.pgrst_pre_request();
insert into pd_qa_result select 'barista_ctx',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
select set_config('request.jwt.claim.sub','c0a70000-0000-4000-8000-000000000001',true),set_config('app.ctx_ready','0',true);
select private.pgrst_pre_request();
insert into pd_qa_result select 'manager_ctx',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
-- Право на детали есть, но в другом (активном) заведении.
select set_config('request.jwt.claim.sub','c0a70000-0000-4000-8000-000000000005',true),set_config('app.ctx_ready','0',true);
insert into pd_qa_result select 'other_venue',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
-- Не член заведения.
select set_config('request.jwt.claim.sub','c0a70000-0000-4000-8000-000000000006',true),set_config('app.ctx_ready','0',true);
insert into pd_qa_result select 'outsider',s.user_id,to_jsonb(s) from public.get_venue_staff('c0a70000-0000-4000-8002-000000000001') s;
reset role;

do $$
declare
  target constant uuid:='c0a70000-0000-4000-8000-000000000003';
  fired constant uuid:='c0a70000-0000-4000-8000-000000000004';
  self constant uuid:='c0a70000-0000-4000-8000-000000000002';
  hidden constant text[]:=array['email','phone','telegram_id','gender','birth_date','employment_date','medical_book_date'];
  r jsonb;
  k text;
  who text;
begin
  -- С правом — всё на месте.
  foreach who in array array['manager','manager_ctx'] loop
  select row into r from pd_qa_result where caller=who and uvr_user=target;
  if r is null then raise exception '% does not see colleague',who;end if;
  if r->>'email'<>'staff-pd-qa-3@example.com' or r->>'phone'<>'+79000000003' or r->>'telegram_id'<>'@pd_qa_3'
     or r->>'gender'<>'female' or r->>'birth_date'<>'1995-05-05' or r->>'employment_date'<>'2025-01-15'
     or r->>'medical_book_date'<>'2027-01-01'
  then raise exception '% with view_staff_details lost personal data: %',who,r;end if;
  end loop;
  select row into r from pd_qa_result where caller='manager_fired' and uvr_user=fired;
  if r->>'email'<>'staff-pd-qa-4@example.com' or r->>'fired_reason'<>'Прогулы' then raise exception 'Manager lost fired staff details: %',r;end if;

  -- Без права (обе ветки has_permission) и с правом в чужом активном заведении —
  -- только имя, аватар, должность, подразделение.
  foreach who in array array['barista','barista_ctx','other_venue'] loop
    if (select count(*) from pd_qa_result where caller=who)<>4 then raise exception '% must still see the whole team',who;end if;
    for r in select row from pd_qa_result where caller=who
             and uvr_user<>case when who='other_venue' then 'c0a70000-0000-4000-8000-000000000005'::uuid else self end loop
      foreach k in array hidden loop
        if r->>k is not null then raise exception '% sees colleague %: %',who,k,r;end if;
      end loop;
      if r->>'first_name' is null or r->>'role_name' is null or r->>'joined_at' is null then
        raise exception '% lost public colleague fields: %',who,r;end if;
    end loop;
  end loop;
  -- Свою строку сотрудник видит целиком.
  select row into r from pd_qa_result where caller='barista' and uvr_user=self;
  if r->>'email'<>'staff-pd-qa-2@example.com' or r->>'phone'<>'+79000000002' then raise exception 'Own row must stay full: %',r;end if;

  select row into r from pd_qa_result where caller='barista_fired' and uvr_user=fired;
  if r is null then raise exception 'Barista must still see fired list';end if;
  if r->>'email' is not null or r->>'fired_reason' is not null then raise exception 'Barista sees fired staff details: %',r;end if;

  if exists(select 1 from pd_qa_result where caller='outsider') then raise exception 'Non-member reads venue staff';end if;

  if has_function_privilege('anon','public.get_venue_staff(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_fired_staff(uuid)','EXECUTE') then raise exception 'Anonymous staff RPC access';end if;
  if not has_function_privilege('authenticated','public.get_venue_staff(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_fired_staff(uuid)','EXECUTE') then raise exception 'Authenticated lost staff RPC access';end if;
  if exists(select 1 from pg_proc where proname in ('get_venue_staff','get_fired_staff') and pronamespace='public'::regnamespace
            and not (proconfig @> array['search_path=public, pg_catalog'])) then raise exception 'search_path missing';end if;
end $$;
rollback;
\echo Staff personal data: colleagues without view_staff_details get only name, avatar, role and department
