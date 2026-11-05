-- Fines chat: approved payroll journal entries are queued for a Telegram
-- notification. The queue is written only by triggers and service-role RPC;
-- the worker claims one row at a time and reports the result back.

alter table public.organization_telegram_settings
  add column fines_chat_id text check (fines_chat_id ~ '^-?[0-9]+$'),
  -- null = notifications are off; entries created earlier are never sent.
  add column fines_notify_from timestamptz;

create table public.payroll_adjustment_notifications (
 adjustment_id uuid not null,
 account_id uuid not null,
 venue_id uuid not null,
 state text not null default 'pending' check (state in ('pending','sending','sent','error','skipped')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 claimed_at timestamptz,
 message_id bigint,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key (account_id, adjustment_id),
 foreign key (account_id, venue_id, adjustment_id)
   references public.payroll_adjustments(account_id, venue_id, id) on delete cascade
);
create index payroll_adjustment_notifications_adjustment
  on public.payroll_adjustment_notifications(account_id, venue_id, adjustment_id);
create index payroll_adjustment_notifications_due
  on public.payroll_adjustment_notifications(available_at) where state in ('pending','error');
create index payroll_adjustment_notifications_sending
  on public.payroll_adjustment_notifications(claimed_at) where state = 'sending';

alter table public.payroll_adjustment_notifications enable row level security;
revoke all on public.payroll_adjustment_notifications from public, anon, authenticated;
grant select on public.payroll_adjustment_notifications to authenticated;
grant all on public.payroll_adjustment_notifications to service_role;
create policy payroll_adjustment_notifications_read on public.payroll_adjustment_notifications
  for select to authenticated using (private.payroll_read(account_id, venue_id));

-- Queue eligible entries; a deleted entry cancels a notification not yet sent.
create function private.payroll_queue_adjustment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare since timestamptz;
begin
 if new.deleted_at is not null then
  update public.payroll_adjustment_notifications
     set state = 'skipped', updated_at = now()
   where account_id = new.account_id and adjustment_id = new.id and state in ('pending','error');
  return null;
 end if;
 if not new.approved
    or new.origin in ('warning_threshold','glide','inventory_deduction')
    or (new.medium = 'bonus' and new.external_state <> 'done') then
  return null;
 end if;
 select s.fines_notify_from into since from public.organization_telegram_settings s where s.account_id = new.account_id;
 if since is null or new.created_at < since then return null; end if;
 -- The photo is attached in a separate step right after the entry is created.
 insert into public.payroll_adjustment_notifications(adjustment_id, account_id, venue_id, available_at)
 values (new.id, new.account_id, new.venue_id, now() + interval '2 minutes')
 on conflict (account_id, adjustment_id) do nothing;
 return null;
end $$;
revoke all on function private.payroll_queue_adjustment_notification() from public, anon, authenticated;
create trigger payroll_queue_adjustment_notification
  after insert or update of approved, deleted_at, external_state on public.payroll_adjustments
  for each row execute function private.payroll_queue_adjustment_notification();

-- Worker: take one due notification. Returns null when nothing is due.
create function public.payroll_claim_adjustment_notification() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.payroll_adjustment_notifications; r public.payroll_adjustments; s public.organization_telegram_settings;
 employee_name text; venue_name text; warnings integer; photo text; month_start date;
begin
 -- A send that never reported back is retried; Telegram may still have it.
 update public.payroll_adjustment_notifications
    set state = 'error', attempts = attempts + 1, available_at = now(), updated_at = now(),
        last_error = 'Отправка не подтверждена за 10 минут'
  where state = 'sending' and message_id is null and claimed_at < now() - interval '10 minutes';
 loop
  select * into q from public.payroll_adjustment_notifications n
   where n.state in ('pending','error') and n.available_at <= now() and n.attempts < 8
   order by n.available_at, n.created_at
   limit 1 for update skip locked;
  if q.adjustment_id is null then return null; end if;
  select * into r from public.payroll_adjustments a where a.account_id = q.account_id and a.id = q.adjustment_id;
  select * into s from public.organization_telegram_settings t where t.account_id = q.account_id;
  if r.id is null or r.deleted_at is not null or not r.approved
     or s.fines_notify_from is null or s.fines_chat_id is null or r.created_at < s.fines_notify_from then
   update public.payroll_adjustment_notifications set state = 'skipped', updated_at = now()
    where account_id = q.account_id and adjustment_id = q.adjustment_id;
   q := null;
   continue;
  end if;
  update public.payroll_adjustment_notifications set state = 'sending', claimed_at = now(), updated_at = now()
   where account_id = q.account_id and adjustment_id = q.adjustment_id;
  select e.name into employee_name from public.payroll_employees e
   where e.account_id = r.account_id and e.venue_id = r.venue_id and e.id = r.employee_id;
  select v.name into venue_name from public.venues v where v.id = r.venue_id;
  month_start := date_trunc('month', r.business_date)::date;
  select count(*) into warnings from public.payroll_adjustments w
   where w.account_id = r.account_id and w.venue_id = r.venue_id and w.employee_id = r.employee_id
     and w.kind = 'warning' and w.deleted_at is null
     and w.business_date >= month_start and w.business_date < (month_start + interval '1 month')::date
     and w.created_at <= r.created_at;
  select p.storage_path into photo from public.payroll_adjustment_photos p
   where p.account_id = r.account_id and p.adjustment_id = r.id
   order by p.created_at, p.id limit 1;
  return jsonb_build_object(
   'adjustment_id', r.id, 'account_id', r.account_id, 'venue_id', r.venue_id, 'venue_name', venue_name,
   'employee_id', r.employee_id, 'employee_name', employee_name,
   'business_date', r.business_date, 'kind', r.kind, 'medium', r.medium, 'amount', r.amount,
   'reason', r.reason, 'origin', r.origin, 'created_at', r.created_at,
   'warnings_in_month', warnings, 'photo_path', photo, 'chat_id', s.fines_chat_id,
   'attempts', q.attempts);
 end loop;
end $$;

-- Worker: report the result of a claimed notification.
create function public.payroll_finish_adjustment_notification(p_adjustment uuid, p_account uuid, p_message_id bigint, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_error is null then
  update public.payroll_adjustment_notifications
     set state = 'sent', message_id = p_message_id, last_error = null, updated_at = now()
   where account_id = p_account and adjustment_id = p_adjustment and state = 'sending';
 else
  update public.payroll_adjustment_notifications
     set state = 'error', attempts = attempts + 1, last_error = left(p_error, 1000), updated_at = now(),
         available_at = now() + make_interval(mins => least((attempts + 1) * (attempts + 1), 60))
   where account_id = p_account and adjustment_id = p_adjustment and state = 'sending';
 end if;
end $$;

-- Worker: the entry was deleted while the notification was being sent.
create function public.payroll_skip_adjustment_notification(p_adjustment uuid, p_account uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.payroll_adjustment_notifications
    set state = 'skipped', updated_at = now()
  where account_id = p_account and adjustment_id = p_adjustment and state = 'sending';
end $$;

revoke all on function public.payroll_claim_adjustment_notification() from public, anon, authenticated;
revoke all on function public.payroll_skip_adjustment_notification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payroll_skip_adjustment_notification(uuid, uuid) to service_role;
revoke all on function public.payroll_finish_adjustment_notification(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.payroll_claim_adjustment_notification() to service_role;
grant execute on function public.payroll_finish_adjustment_notification(uuid, uuid, bigint, text) to service_role;

-- Settings UI: same right as the Telegram bot settings.
create function public.payroll_save_fines_chat(p_chat_id text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.get_active_account_id(); chat text := nullif(trim(p_chat_id), '');
begin
 if a is null or not public.has_permission('settings.manage_integrations') then
  raise exception 'Нет доступа к настройкам интеграций';
 end if;
 if chat is not null and chat !~ '^-?[0-9]+$' then raise exception 'Укажите числовой идентификатор чата'; end if;
 if p_enabled and chat is null then raise exception 'Выберите чат для штрафов'; end if;
 update public.organization_telegram_settings
    set fines_chat_id = chat,
        fines_notify_from = case when p_enabled then coalesce(fines_notify_from, now()) else null end,
        updated_at = now(), updated_by = auth.uid()
  where account_id = a;
 if not found then raise exception 'Сначала подключите Telegram-бота'; end if;
end $$;
revoke all on function public.payroll_save_fines_chat(text, boolean) from public, anon;
grant execute on function public.payroll_save_fines_chat(text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
