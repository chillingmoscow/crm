-- 393: включить автовыдачу может только тот, кто сам может проводить выплаты.
--
-- Автовыдача проводит деньги с кэшбокса без человека. В 392 её включал любой с
-- payroll.configure; теперь для включения нужны те же права, что для ручной
-- выдачи: payroll.pay и finance.create_transaction. Выключить по-прежнему
-- может настройщик.

begin;

-- Последнее тело — 392_payroll_payout_auto.sql.
create or replace function public.payroll_payout_set_auto(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid; v uuid; u uuid; x text;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.configure') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if p_enabled is null then raise exception 'Укажите, включить ли автовыдачу'; end if;
  if p_enabled and (not public.has_permission('payroll.pay') or not public.has_permission('finance.create_transaction')) then
    raise exception 'Включить автовыдачу могут те, у кого есть права на выплаты и операции в финансах';
  end if;
  update public.payroll_payout_settings set auto_issue = p_enabled, updated_by = u, updated_at = now()
   where account_id = a and venue_id = v returning venue_id::text into x;
  if x is null then raise exception 'Сначала сохраните график выплат'; end if;
  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, v, u, 'payout_auto', jsonb_build_object('enabled', p_enabled));
end $function$;

revoke all on function public.payroll_payout_set_auto(boolean) from public, anon;
grant execute on function public.payroll_payout_set_auto(boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.payroll_payout_set_auto(boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_payout_set_auto(boolean)', 'execute') then
    raise exception 'Права на payroll_payout_set_auto выставлены неверно';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
