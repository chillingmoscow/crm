-- Payroll payouts may be booked in Adesk on another account than the app account they
-- were paid from: the app cash box («Кэшбокс») is the Adesk operating account. The
-- override applies only to the payout mirror; finance imports keep using adesk_id.

alter table public.bank_accounts add column adesk_payout_id bigint check (adesk_payout_id > 0);
comment on column public.bank_accounts.adesk_payout_id is
  'Счёт Adesk, с которого проводятся выплаты зарплаты с этого счёта; null — тот же, что adesk_id';

-- Worker: take one due payout. Returns null when nothing is due.
create or replace function public.payroll_claim_adesk_sync() returns jsonb
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
 -- A payout may leave Adesk from another account than the app one (cash box → operating account).
 select coalesce(b.adesk_payout_id, b.adesk_id) into bank_adesk from public.bank_accounts b
  where b.account_id = q.account_id and b.id = t.bank_account_id;
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

