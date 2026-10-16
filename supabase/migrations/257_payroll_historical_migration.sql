begin;

-- An imported current balance already contains historical expenses. Only
-- transactions at/after this anchor can change that balance again.
alter table public.bank_accounts
 add column balance_anchor_at timestamptz,
 add column balance_anchor_amount numeric(15,2),
 add column excluded_from_balance boolean not null default false,
 add column adesk_id bigint,
 add constraint bank_accounts_anchor_pair check((balance_anchor_at is null)=(balance_anchor_amount is null)),
 add constraint bank_accounts_adesk_identity unique(account_id,adesk_id);
alter table public.legal_entities add column adesk_id bigint,
 add constraint legal_entities_adesk_identity unique(account_id,adesk_id);

create function private.bank_import_identity_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   if new.balance_anchor_at is not null or new.adesk_id is not null then raise exception 'Импорт доступен только серверному обработчику';end if;
  elsif new.balance_anchor_at is distinct from old.balance_anchor_at
   or new.balance_anchor_amount is distinct from old.balance_anchor_amount
   or new.adesk_id is distinct from old.adesk_id then
   raise exception 'Нельзя изменить контрольный остаток переноса';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.bank_import_identity_guard() from public,anon,authenticated;
create trigger bank_import_identity_guard before insert or update on public.bank_accounts
for each row execute function private.bank_import_identity_guard();

create or replace function public.transaction_balance_recalc()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare old_active boolean:=false;new_active boolean:=false;
 old_source boolean:=false;old_dest boolean:=false;new_source boolean:=false;new_dest boolean:=false;
begin
 if tg_op in ('UPDATE','DELETE') then
  old_active:=old.deleted_at is null;
  select balance_anchor_at is null or old.date>=balance_anchor_at into old_source from public.bank_accounts where id=old.bank_account_id;
  if old.to_bank_account_id is not null then
   select balance_anchor_at is null or old.date>=balance_anchor_at into old_dest from public.bank_accounts where id=old.to_bank_account_id;
  end if;
 end if;
 if tg_op in ('INSERT','UPDATE') then
  new_active:=new.deleted_at is null;
  select balance_anchor_at is null or new.date>=balance_anchor_at into new_source from public.bank_accounts where id=new.bank_account_id;
  if new.to_bank_account_id is not null then
   select balance_anchor_at is null or new.date>=balance_anchor_at into new_dest from public.bank_accounts where id=new.to_bank_account_id;
  end if;
 end if;
 if old_active then
  if old.type='income' and old_source then perform public.apply_transaction_balance_delta(old.bank_account_id,-old.amount);
  elsif old.type='expense' and old_source then perform public.apply_transaction_balance_delta(old.bank_account_id,old.amount);
  elsif old.type='transfer' then
   if old_source then perform public.apply_transaction_balance_delta(old.bank_account_id,old.amount);end if;
   if old_dest then perform public.apply_transaction_balance_delta(old.to_bank_account_id,-old.amount);end if;
  end if;
 end if;
 if new_active then
  if new.type='income' and new_source then perform public.apply_transaction_balance_delta(new.bank_account_id,new.amount);
  elsif new.type='expense' and new_source then perform public.apply_transaction_balance_delta(new.bank_account_id,-new.amount);
  elsif new.type='transfer' then
   if new_source then perform public.apply_transaction_balance_delta(new.bank_account_id,-new.amount);end if;
   if new_dest then perform public.apply_transaction_balance_delta(new.to_bank_account_id,new.amount);end if;
  end if;
 end if;
 return coalesce(new,old);
end $$;
revoke all on function public.transaction_balance_recalc() from public,anon,authenticated;

alter table public.payroll_settings add column historical_through date;
alter table public.payroll_adjustment_comments alter column author_id drop not null,
 add column source_ref text,
 add column source_author_name text,
 add constraint payroll_comment_source_author check(author_id is not null or source_ref is not null),
 add constraint payroll_comment_source_unique unique(account_id,venue_id,source_ref);

-- Keep the established commit implementation and its tenant/lease checks.
-- A legacy day can still receive journal edits, but a source refresh cannot
-- replace its agreed historical calculation or create retroactive fines.
do $$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.payroll_commit_day(jsonb)'::regprocedure);
 needle:='perform pg_advisory_xact_lock(hashtextextended(v::text,0));';
 replacement:=needle||E'\n if exists(select 1 from public.payroll_settings where account_id=a and venue_id=v and d<=historical_through) then\n update public.payroll_source_days set state=''complete'',error=null,synced_at=now() where account_id=a and venue_id=v and business_date=d;\n return;end if;';
 if position(needle in definition)=0 then raise exception 'payroll_commit_day changed: inspect before migrating';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.transactions_audit_trigger()'::regprocedure);
 needle:='if TG_OP <> ''DELETE'' and NEW.source <> ''manual'' then';
 replacement:='if TG_OP <> ''DELETE'' and NEW.source <> ''manual'' and not exists(select 1 from public.payroll_payments p where p.transaction_id=NEW.id) then';
 if position(needle in definition)=0 then raise exception 'Transaction audit changed: inspect before migrating';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('private.payroll_adjustment_changed()'::regprocedure);
 needle:='case when tg_op=''INSERT'' then ''created''';
 replacement:='case when new.origin=''glide'' then ''imported'' when tg_op=''INSERT'' then ''created''';
 if position(needle in definition)=0 then raise exception 'Adjustment history changed: inspect before migrating';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('private.payroll_generate_discipline()'::regprocedure);
 needle:='begin';
 replacement:=E'begin\n if exists(select 1 from public.payroll_settings where account_id=new.account_id and venue_id=new.venue_id and new.business_date<=historical_through) then return new;end if;';
 if position(needle in definition)=0 then raise exception 'Discipline trigger changed';end if;
 execute overlay(definition placing replacement from position(needle in definition) for length(needle));

 definition:=pg_get_functiondef('private.payroll_warning_thresholds()'::regprocedure);
 replacement:=E'begin\n if new.origin=''glide'' then return new;end if;';
 execute overlay(definition placing replacement from position(needle in definition) for length(needle));
end $$;

alter policy payroll_audit_salary_access on public.audit_logs
 using(entity_type not in ('payroll_adjustment','payroll_transfer','payroll_import') or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.view')));

comment on column public.payroll_settings.historical_through is 'Последний день сохранённого исторического расчёта. Записи журнала редактируются с аудитом; фоновые источники его не заменяют.';
comment on column public.bank_accounts.balance_anchor_at is 'Момент контрольного остатка при переносе. Более ранние операции остаются в истории без повторного влияния на текущий баланс.';
commit;
