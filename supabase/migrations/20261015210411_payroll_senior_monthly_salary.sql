begin;
-- Confirmed salary: 20,000 RUB from October. September's imported allowance is retained.
do $$
declare m public.payroll_models;r public.payroll_rule_versions;
begin
 for m in select pm.* from public.payroll_models pm join public.roles p on p.id=pm.role_id where p.code='payroll_senior_hookah' and pm.is_role_default and not pm.archived loop
  select * into r from public.payroll_rule_versions where model_id=m.id and employee_id is null and valid_from<='2026-10-01' order by valid_from desc,created_at desc,id desc limit 1;
  if r.id is null then raise exception 'Senior conditions are missing';end if;
  if coalesce(r.monthly_amount,m.monthly_amount)=20000 then continue;end if;
  insert into public.payroll_rule_versions(account_id,venue_id,model_id,valid_from,rates,experience_steps,monthly_amount,tenure_requires_exam,config,change_reason)
  values(m.account_id,m.venue_id,m.id,'2026-10-01',r.rates,r.experience_steps,20000,r.tenure_requires_exam,r.config||'{"shift_pay":true}'::jsonb,'Оклад старшего кальянного мастера: 20 000 ₽ с октября 2026, подтверждён владельцем');
  -- Only the monthly salary date needs recalculation; all daily rates are identical.
  update public.payroll_source_days set state='pending',error=null where account_id=m.account_id and venue_id=m.venue_id and business_date='2026-10-01' and state='complete';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
