-- Rehearse the old-to-new configuration migration without changing real data.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
values('cf310000-0000-4000-8000-000000000001','authenticated','authenticated','integration-settings-qa@import.local',now(),'{}','{}',now(),now());
insert into public.accounts(id,name,owner_id) values('cf310000-0000-4000-8000-000000000010','Настройки QA','cf310000-0000-4000-8000-000000000001');
insert into public.accounts(id,name,owner_id) values('cf310000-0000-4000-8000-000000000011','Старый бот QA','cf310000-0000-4000-8000-000000000001');
alter table public.organization_telegram_settings drop column candidate_chat_id, drop column candidate_chat_title, drop column default_chat_title;
-- The current audit function refers to the new column. Recreate the former
-- trigger body for the old-schema fixture before inserting test settings.
create or replace function private.organization_telegram_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$begin return new;end $$;
insert into public.organization_telegram_settings(account_id,secret,bot_username,default_chat_id,updated_by)
values('cf310000-0000-4000-8000-000000000010','{"encrypted":"qa-only","iv":"qa","tag":"qa"}','qa_bot','-100111','cf310000-0000-4000-8000-000000000001');
insert into public.candidate_connections(account_id,form_id,enabled,secret_hash,telegram_chat_id,created_by)
values('cf310000-0000-4000-8000-000000000010','form123',true,repeat('b',64),'-100222','cf310000-0000-4000-8000-000000000001');
insert into public.candidate_connections(account_id,form_id,enabled,secret_hash,telegram_chat_id,telegram_secret,created_by)
values('cf310000-0000-4000-8000-000000000011','form456',true,repeat('c',64),'-100333','{"encrypted":"legacy-qa-only","iv":"qa","tag":"qa"}','cf310000-0000-4000-8000-000000000001');
\ir ../migrations/20261031002045_integrations_recruiting_settings.sql
do $$begin
 if not exists(select 1 from public.organization_telegram_settings where account_id='cf310000-0000-4000-8000-000000000010'
    and default_chat_id='-100111' and candidate_chat_id='-100222' and secret->>'encrypted'='qa-only') then
   raise exception 'Migration lost a destination or changed the token';
 end if;
 if not exists(select 1 from public.candidate_connections where account_id='cf310000-0000-4000-8000-000000000010'
    and form_id='form123' and enabled and secret_hash=repeat('b',64)) then raise exception 'Migration changed webhook authentication';end if;
 if has_table_privilege('anon','public.organization_telegram_settings','SELECT')
    or has_table_privilege('authenticated','public.organization_telegram_settings','SELECT') then raise exception 'Bot settings exposed';end if;
 if not exists(select 1 from public.organization_telegram_settings where account_id='cf310000-0000-4000-8000-000000000011'
    and default_chat_id='-100333' and candidate_chat_id='-100333' and secret->>'encrypted'='legacy-qa-only') then raise exception 'Legacy-only bot lost';end if;
end $$;
update public.organization_telegram_settings set candidate_chat_id=null where account_id='cf310000-0000-4000-8000-000000000010';
do $$begin
 if not exists(select 1 from public.audit_logs where entity_id='cf310000-0000-4000-8000-000000000010'
   and action_code='integration.updated' and details->>'provider'='telegram' and details ? 'candidate_chat_id') then raise exception 'Destination change not audited';end if;
 if exists(select 1 from public.audit_logs where entity_id='cf310000-0000-4000-8000-000000000010' and details::text like '%qa-only%') then raise exception 'Credential leaked to journal';end if;
end $$;
rollback;
\echo 'Integration settings migration checks passed'
