-- Uniqueness and tenant isolation for Telegram chats and the action journal.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values('cf313000-0000-4000-8000-000000000001','authenticated','authenticated','tg-chats-a@import.local',now(),'{}','{}',now(),now()),
      ('cf313000-0000-4000-8000-000000000002','authenticated','authenticated','tg-chats-b@import.local',now(),'{}','{}',now(),now());
insert into public.accounts(id,name,owner_id) values
 ('cf313000-0000-4000-8000-000000000010','Чаты A','cf313000-0000-4000-8000-000000000001'),
 ('cf313000-0000-4000-8000-000000000011','Чаты B','cf313000-0000-4000-8000-000000000002');
insert into public.telegram_chats(account_id,chat_id,title) values
 ('cf313000-0000-4000-8000-000000000010','-100500','A чат'),
 ('cf313000-0000-4000-8000-000000000011','-100500','B чат');
insert into public.staff_telegram_actions(account_id,user_id,kind,event_key,chat_id,result)
values('cf313000-0000-4000-8000-000000000010','cf313000-0000-4000-8000-000000000002','remove','fire-1','-100500','removed');

do $$begin
 begin
  insert into public.telegram_chats(account_id,chat_id) values('cf313000-0000-4000-8000-000000000010','-100500');
  raise exception 'duplicate chat accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.staff_telegram_actions(account_id,user_id,kind,event_key,chat_id,result)
  values('cf313000-0000-4000-8000-000000000010','cf313000-0000-4000-8000-000000000002','remove','fire-1','-100500','removed');
  raise exception 'duplicate action accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.staff_telegram_actions(account_id,user_id,kind,event_key,chat_id,result)
  values('cf313000-0000-4000-8000-000000000010','cf313000-0000-4000-8000-000000000002','kick','k','-1','removed');
  raise exception 'bad kind accepted';
 exception when check_violation then null; end;
 begin
  insert into public.staff_telegram_actions(account_id,user_id,kind,event_key,chat_id,result)
  values('cf313000-0000-4000-8000-000000000010','cf313000-0000-4000-8000-000000000002','remove','k2','-1','done');
  raise exception 'bad result accepted';
 exception when check_violation then null; end;
 if not exists(select 1 from pg_constraint where conname='candidate_jobs_kind_check' and pg_get_constraintdef(oid) like '%chat_invites%' and pg_get_constraintdef(oid) like '%file_cleanup%') then
  raise exception 'chat_invites missing from candidate_jobs kinds'; end if;
end $$;

-- Account B's owner (no integration right in A, not even a member of A) sees nothing of A.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cf313000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$begin
 if (select count(*) from public.telegram_chats where account_id='cf313000-0000-4000-8000-000000000010')<>0 then raise exception 'Foreign chats visible';end if;
 if (select count(*) from public.staff_telegram_actions where account_id='cf313000-0000-4000-8000-000000000010')<>0 then raise exception 'Foreign journal visible';end if;
 begin
  insert into public.staff_telegram_actions(account_id,user_id,kind,event_key,chat_id,result)
  values('cf313000-0000-4000-8000-000000000011','cf313000-0000-4000-8000-000000000002','remove','x','-1','removed');
  raise exception 'journal write allowed for authenticated';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'Telegram chats checks passed'
