-- Telegram chats that employees are invited to / removed from, plus an
-- idempotency journal of invite/remove steps. Managed by users who may manage
-- integrations (the same right that guards the Telegram bot settings).

create table public.telegram_chats (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id) on delete cascade,
 chat_id text not null,
 title text not null default '',
 invite boolean not null default true,
 -- Empty = the chat is for every role when invite is on.
 role_ids uuid[] not null default '{}',
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (account_id, id),
 unique (account_id, chat_id)
);

create table public.staff_telegram_actions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id) on delete cascade,
 user_id uuid not null,
 kind text not null check (kind in ('invite','remove')),
 event_key text not null,
 chat_id text not null,
 result text not null check (result in ('invited','removed','absent','unconfirmed','error')),
 detail text,
 created_at timestamptz not null default now(),
 unique (account_id, id),
 unique (account_id, event_key, chat_id)
);

alter table public.telegram_chats enable row level security;
alter table public.staff_telegram_actions enable row level security;
revoke all on public.telegram_chats, public.staff_telegram_actions from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_chats to authenticated;
grant select on public.staff_telegram_actions to authenticated;
grant all on public.telegram_chats, public.staff_telegram_actions to service_role;

create policy telegram_chats_select on public.telegram_chats for select to authenticated
 using (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')));
create policy telegram_chats_insert on public.telegram_chats for insert to authenticated
 with check (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')));
create policy telegram_chats_update on public.telegram_chats for update to authenticated
 using (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')))
 with check (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')));
create policy telegram_chats_delete on public.telegram_chats for delete to authenticated
 using (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')));

-- Journal: read-only for users; writes happen through the service role only.
create policy staff_telegram_actions_select on public.staff_telegram_actions for select to authenticated
 using (account_id = (select public.get_active_account_id()) and (select public.has_permission('settings.manage_integrations')));

-- Chat invitations run as a background job kind.
alter table public.candidate_jobs drop constraint candidate_jobs_kind_check;
alter table public.candidate_jobs add constraint candidate_jobs_kind_check
 check (kind in ('notify','file_cleanup','hired','chat_invites'));
