-- One encrypted bot per organization, shared by notification producers.
create table public.organization_telegram_settings (
 account_id uuid primary key references public.accounts(id) on delete cascade,
 secret jsonb not null,bot_username text,default_chat_id text,
 verified_at timestamptz,updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
alter table public.organization_telegram_settings enable row level security;
revoke all on public.organization_telegram_settings from public,anon,authenticated;
grant all on public.organization_telegram_settings to service_role;
insert into public.organization_telegram_settings(account_id,secret,default_chat_id,updated_by)
 select account_id,telegram_secret,telegram_chat_id,created_by from public.candidate_connections where telegram_secret is not null
 on conflict(account_id) do nothing;
-- Audit metadata only: encrypted credentials never enter the common journal.
create function private.organization_telegram_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.updated_by,'integration.updated','integration',new.account_id,
 jsonb_build_object('provider','telegram','bot_username',new.bot_username,'chat_id',new.default_chat_id,
 'credentials_changed',case when tg_op='INSERT' then true else new.secret is distinct from old.secret end));
 return new;
end $$;
revoke all on function private.organization_telegram_audit() from public,anon,authenticated;
create trigger organization_telegram_audit after insert or update on public.organization_telegram_settings for each row execute function private.organization_telegram_audit();
