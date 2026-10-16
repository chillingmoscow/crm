begin;
-- Business date alone cannot distinguish history from a new backdated expense.
alter table public.transactions add column balance_covered_by_import boolean not null default false;
-- The independent invoker guard below protects this service-only metadata.
-- The linked-payment guard can ignore it without allowing changes to payee,
-- amount, date, account, or any other financial field.
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('private.payroll_transaction_guard()'::regprocedure);
 needle:='array[''deleted_at'',''deleted_by'',''updated_at'',''updated_by'']';
 if position(needle in definition)=0 then raise exception 'Linked transaction guard changed';end if;
 execute replace(definition,needle,'array[''deleted_at'',''deleted_by'',''updated_at'',''updated_by'',''balance_covered_by_import'']');
end $$;
-- This exact migration package was written under 257. Mark it while the old
-- balance function still runs: it suppresses both old/new sides equally.
update public.transactions t set balance_covered_by_import=true
where t.source='import' and t.source_external_id like 'fees:%'
 and exists(select 1 from public.payroll_payments p where p.transaction_id=t.id and p.input_snapshot->>'source'='Fees/Transactions')
 and exists(select 1 from public.bank_accounts b where b.id=t.bank_account_id and b.balance_anchor_at is not null and t.date<b.balance_anchor_at);

-- Abort for review if someone entered an unmarked backdated operation during
-- the short 257 -> 258 transition. Never silently accept an incorrect balance.
do $$begin
 if exists(select 1 from public.transactions t join public.bank_accounts b
  on b.id=t.bank_account_id or b.id=t.to_bank_account_id
  where b.balance_anchor_at is not null and t.date<b.balance_anchor_at
   and not t.balance_covered_by_import and t.deleted_at is null) then
  raise exception 'Uncovered backdated operations require balance reconciliation before cutover';
 end if;
end $$;

create function private.transaction_import_identity_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
  if (tg_op='INSERT' and new.balance_covered_by_import)
   or (tg_op='UPDATE' and new.balance_covered_by_import is distinct from old.balance_covered_by_import) then
   raise exception 'Признак исторического остатка доступен только серверному импорту';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.transaction_import_identity_guard() from public,anon,authenticated;
create trigger transaction_import_identity_guard before insert or update on public.transactions
 for each row execute function private.transaction_import_identity_guard();

do $$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.transaction_balance_recalc()'::regprocedure);
 needle:='balance_anchor_at is null or old.date>=balance_anchor_at';
 replacement:='not old.balance_covered_by_import or balance_anchor_at is null or old.date>=balance_anchor_at';
 if position(needle in definition)=0 then raise exception 'Balance function changed: inspect before migrating';end if;
 definition:=replace(definition,needle,replacement);
 needle:='balance_anchor_at is null or new.date>=balance_anchor_at';
 replacement:='not new.balance_covered_by_import or balance_anchor_at is null or new.date>=balance_anchor_at';
 if position(needle in definition)=0 then raise exception 'Balance function changed: inspect before migrating';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('private.payroll_adjustment_changed()'::regprocedure);
 needle:='case when new.origin=''glide'' then ''imported''';
 replacement:='case when tg_op=''INSERT'' and new.origin=''glide'' then ''imported''';
 if position(needle in definition)=0 then raise exception 'Adjustment history changed: inspect before migrating';end if;
 execute replace(definition,needle,replacement);
end $$;
comment on column public.transactions.balance_covered_by_import is 'Расход уже включён в контрольный остаток переноса. Обычные новые операции, включая задним числом, всегда меняют остаток.';
notify pgrst,'reload schema';
commit;
