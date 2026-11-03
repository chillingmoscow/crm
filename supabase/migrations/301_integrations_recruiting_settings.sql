-- Separate notification destinations from website intake. Existing chat and
-- credentials remain valid; no key is generated or rotated by this migration.
alter table public.organization_telegram_settings
  add column candidate_chat_id text check (candidate_chat_id ~ '^-?[0-9]+$'),
  add column default_chat_title text,
  add column candidate_chat_title text;

-- Legacy installations could still save the bot in candidate_connections after
-- migration 274. Bring such connections forward without replacing an org bot.
insert into public.organization_telegram_settings(account_id,secret,default_chat_id,updated_by)
select account_id,telegram_secret,telegram_chat_id,created_by
from public.candidate_connections where telegram_secret is not null
on conflict(account_id) do nothing;

update public.organization_telegram_settings o
set candidate_chat_id = c.telegram_chat_id
from public.candidate_connections c
where c.account_id = o.account_id and c.telegram_chat_id is not null;

create or replace function private.organization_telegram_audit()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.updated_by,'integration.updated','integration',new.account_id,
 jsonb_build_object('provider','telegram','bot_username',new.bot_username,
 'chat_id',new.default_chat_id,'candidate_chat_id',new.candidate_chat_id,
 'credentials_changed',case when tg_op='INSERT' then true else new.secret is distinct from old.secret end));
 return new;
end $$;
revoke all on function private.organization_telegram_audit() from public,anon,authenticated;
notify pgrst, 'reload schema';
