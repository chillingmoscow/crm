begin;
-- The imported balance already contains the original payout. Suppress only
-- the first INSERT, then apply normal old/new deltas for edits/cancellation.
-- This keeps a payroll payout the same financial entity as any other expense.
do $$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.transaction_balance_recalc()'::regprocedure);
 needle:='not old.balance_covered_by_import or balance_anchor_at is null or old.date>=balance_anchor_at';
 if position(needle in definition)=0 then raise exception 'Balance function changed';end if;
 definition:=replace(definition,needle,'true');
 needle:='not new.balance_covered_by_import or balance_anchor_at is null or new.date>=balance_anchor_at';
 replacement:='tg_op<>''INSERT'' or not new.balance_covered_by_import or balance_anchor_at is null or new.date>=balance_anchor_at';
 if position(needle in definition)=0 then raise exception 'Balance function changed';end if;
 execute replace(definition,needle,replacement);
end $$;
comment on column public.transactions.balance_covered_by_import is 'Исходная сумма уже учтена в контрольном остатке: пропускается только первоначальная вставка. Последующие изменения и отмена меняют остаток обычным порядком.';
notify pgrst,'reload schema';
commit;
