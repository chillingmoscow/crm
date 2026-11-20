-- Payroll payouts are mirrored to Adesk, as the Glide/n8n flow used to do.
-- A new salary or bonus payout is queued by a trigger; the worker creates the
-- Adesk expense and stores its id. Cancelling the payout removes it again.
-- Historical payouts (imported from Glide, already in Adesk) and tip
-- withdrawals (reconciled by the encashment flow) are never queued.

-- Adesk identities: the expense category per finance category and the project per venue.
alter table public.finance_categories add column adesk_id bigint check (adesk_id > 0);
alter table public.payroll_settings add column adesk_project_id bigint check (adesk_project_id > 0);

create table public.payroll_adesk_sync (
 payment_id uuid not null,
 account_id uuid not null,
 venue_id uuid not null,
 -- pending: needs work; sending: claimed by the worker; synced: Adesk matches the payout;
 -- error: retried with backoff; review: needs a person (ambiguous match, missing mapping).
 state text not null default 'pending' check (state in ('pending','sending','synced','error','review')),
 adesk_id bigint check (adesk_id > 0),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 claimed_at timestamptz,
 last_error text,
 synced_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key (account_id, payment_id),
 foreign key (account_id, venue_id, payment_id)
   references public.payroll_payments(account_id, venue_id, id) on delete cascade
);
create index payroll_adesk_sync_payment on public.payroll_adesk_sync(account_id, venue_id, payment_id);
create index payroll_adesk_sync_due on public.payroll_adesk_sync(available_at) where state in ('pending','error');
create index payroll_adesk_sync_sending on public.payroll_adesk_sync(claimed_at) where state = 'sending';

alter table public.payroll_adesk_sync enable row level security;
revoke all on public.payroll_adesk_sync from public, anon, authenticated;
grant select on public.payroll_adesk_sync to authenticated;
grant all on public.payroll_adesk_sync to service_role;
create policy payroll_adesk_sync_read on public.payroll_adesk_sync
  for select to authenticated using (private.payroll_read(account_id, venue_id));

-- Queue new payouts; a state change (cancel or restore) asks the worker to reconcile again.
create function private.payroll_queue_adesk_sync() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
 if tg_op = 'INSERT' then
  if new.state = 'posted' and new.kind in ('salary','advance')
     and new.cashbox_id is null and new.legacy_evidence_id is null then
   insert into public.payroll_adesk_sync(payment_id, account_id, venue_id)
   values (new.id, new.account_id, new.venue_id)
   on conflict (account_id, payment_id) do nothing;
  end if;
 elsif new.state is distinct from old.state then
  update public.payroll_adesk_sync
     set state = 'pending', attempts = 0, available_at = now(), last_error = null, updated_at = now()
   where account_id = new.account_id and payment_id = new.id and state <> 'sending';
  -- A claimed row is picked up again once the worker reports back (see finish).
 end if;
 return null;
end $$;
revoke all on function private.payroll_queue_adesk_sync() from public, anon, authenticated;
create trigger payroll_queue_adesk_sync
  after insert or update of state on public.payroll_payments
  for each row execute function private.payroll_queue_adesk_sync();

-- Worker: take one due payout. Returns null when nothing is due.
create function public.payroll_claim_adesk_sync() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare q public.payroll_adesk_sync; p public.payroll_payments; t public.transactions;
 employees integer; months date[]; employee_name text; tz text;
 bank_adesk bigint; category_adesk bigint; project bigint;
begin
 -- A call that never reported back is reconciled again: the worker looks Adesk up before writing.
 update public.payroll_adesk_sync
    set state = 'error', attempts = attempts + 1, available_at = now(), updated_at = now(),
        last_error = 'Ответ Adesk не получен за 10 минут'
  where state = 'sending' and claimed_at < now() - interval '10 minutes';
 select * into q from public.payroll_adesk_sync s
  where s.state in ('pending','error') and s.available_at <= now() and s.attempts < 10
  order by s.available_at, s.created_at
  limit 1 for update skip locked;
 if q.payment_id is null then return null; end if;
 select * into p from public.payroll_payments x where x.account_id = q.account_id and x.id = q.payment_id;
 select * into t from public.transactions x where x.account_id = q.account_id and x.id = p.transaction_id;
 select count(distinct al.employee_id), array_agg(distinct al.month order by al.month)
   into employees, months
   from public.payroll_allocations al where al.account_id = q.account_id and al.payment_id = p.id;
 select e.name into employee_name from public.payroll_employees e
  where e.account_id = q.account_id and e.id = (
   select al.employee_id from public.payroll_allocations al
    where al.account_id = q.account_id and al.payment_id = p.id limit 1);
 select v.timezone into tz from public.venues v where v.id = q.venue_id;
 select b.adesk_id into bank_adesk from public.bank_accounts b where b.account_id = q.account_id and b.id = t.bank_account_id;
 select c.adesk_id into category_adesk from public.finance_categories c where c.account_id = q.account_id and c.id = t.category_id;
 select s.adesk_project_id into project from public.payroll_settings s where s.account_id = q.account_id and s.venue_id = q.venue_id;
 update public.payroll_adesk_sync set state = 'sending', claimed_at = now(), updated_at = now()
  where account_id = q.account_id and payment_id = q.payment_id;
 return jsonb_build_object(
  'payment_id', p.id, 'account_id', q.account_id, 'venue_id', q.venue_id,
  'payment_state', p.state, 'adesk_id', q.adesk_id, 'amount', p.amount,
  'date', (p.occurred_at at time zone coalesce(tz, 'Europe/Moscow'))::date,
  'employees', employees, 'months', to_jsonb(months), 'employee_name', employee_name,
  'bank_adesk_id', bank_adesk, 'category_adesk_id', category_adesk, 'project_adesk_id', project,
  'attempts', q.attempts);
end $$;

-- Worker: report the result. An Adesk id is kept even when the payout changed meanwhile,
-- so a cancel that raced the create still knows which operation to remove.
create function public.payroll_finish_adesk_sync(p_payment uuid, p_account uuid, p_state text, p_adesk_id bigint, p_error text)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare current_state text; payment_state text;
begin
 if p_state not in ('synced','error','review') then raise exception 'Некорректный результат синхронизации'; end if;
 select s.state into current_state from public.payroll_adesk_sync s
  where s.account_id = p_account and s.payment_id = p_payment for update;
 if current_state is null then return; end if;
 update public.payroll_adesk_sync
    set adesk_id = case when p_state = 'synced' then p_adesk_id else coalesce(p_adesk_id, adesk_id) end,
        state = case when current_state = 'sending' then p_state else current_state end,
        attempts = case when current_state = 'sending' and p_state = 'error' then attempts + 1 else attempts end,
        available_at = case when current_state = 'sending' and p_state = 'error'
          then now() + make_interval(mins => least((attempts + 1) * (attempts + 1), 60)) else available_at end,
        last_error = case when p_state = 'synced' then null else left(p_error, 1000) end,
        synced_at = case when p_state = 'synced' then now() else synced_at end,
        updated_at = now()
  where account_id = p_account and payment_id = p_payment;
 -- The payout was cancelled or restored while the worker held it: reconcile once more.
 select x.state into payment_state from public.payroll_payments x where x.account_id = p_account and x.id = p_payment;
 if current_state = 'sending' and p_state = 'synced'
    and ((payment_state = 'posted') <> (p_adesk_id is not null)) then
  update public.payroll_adesk_sync set state = 'pending', available_at = now(), updated_at = now()
   where account_id = p_account and payment_id = p_payment;
 end if;
end $$;

-- People: send a payout again after fixing the cause (mapping, a duplicate in Adesk).
create function public.payroll_retry_adesk_sync(p_payment uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid; v uuid; u uuid;
begin
 select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
 update public.payroll_adesk_sync
    set state = 'pending', attempts = 0, available_at = now(), last_error = null, updated_at = now()
  where account_id = a and venue_id = v and payment_id = p_payment and state in ('error','review');
 if not found then raise exception 'Выплата не ожидает повторной отправки'; end if;
 insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
 values (a, v, p_payment, u, 'adesk_retry', '{}'::jsonb);
end $$;

revoke all on function public.payroll_claim_adesk_sync() from public, anon, authenticated;
revoke all on function public.payroll_finish_adesk_sync(uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.payroll_retry_adesk_sync(uuid) from public, anon;
grant execute on function public.payroll_claim_adesk_sync() to service_role;
grant execute on function public.payroll_finish_adesk_sync(uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.payroll_retry_adesk_sync(uuid) to authenticated;
