-- Журнал «запрошено обновление отчётов» (статистика продаж и допродажи) —
-- только когда отчёты действительно поставлены в очередь.
--
-- Раньше sales_request_month_reports (266) и sales_request_additional_month
-- (283) писали audit_logs при любом вызове. Для месяца без завершённых дней
-- функция возвращала 0, приложение показывало «В этом месяце пока нет
-- завершённых рабочих дней», а в журнале уже стояла запись о запросе, которого
-- не было. Логика постановки в очередь не меняется, меняется только условие
-- записи в журнал.

begin;

create or replace function public.sales_request_month_reports(p_month date,p_expected_venue uuid) returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid;v uuid;n integer;
begin
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 if auth.uid() is null or a is null or v is null or not public.has_permission('sales.sync_shifts') then raise exception 'Нет доступа к обновлению статистики';end if;
 if p_expected_venue is distinct from v then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if not exists(select 1 from public.venues where id=v and account_id=a) then raise exception 'Заведение недоступно';end if;
 n:=private.sales_request_month_reports(v,p_month,true);
 if n>0 then
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
  values(a,v,auth.uid(),'sales.statistics.refresh_requested','venue',v,jsonb_build_object('month',p_month,'reports',n));
 end if;
 return n;
end $$;

create or replace function public.sales_request_additional_month(p_month date,p_expected_venue uuid) returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v uuid:=public.get_active_venue_id();d date;n integer:=0;
begin
 if auth.uid() is null or not public.has_permission('sales.sync_shifts') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к обновлению допродаж';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if p_month is null or extract(day from p_month)<>1 or extract(year from p_month) not between 2000 and 2100 then raise exception 'Проверьте месяц';end if;
 for d in select generate_series(p_month,p_month+interval '1 month'-interval '1 day',interval '1 day')::date loop n:=n+private.sales_request_additional_day(v,d,true);end loop;
 if n>0 then
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(public.get_active_account_id(),v,auth.uid(),'sales.additional.refresh_requested','sales_settings',v,jsonb_build_object('month',p_month,'reports',n));
 end if;
 return n;
end $$;

revoke all on function public.sales_request_month_reports(date,uuid) from public,anon;
grant execute on function public.sales_request_month_reports(date,uuid) to authenticated;
revoke all on function public.sales_request_additional_month(date,uuid) from public,anon;
grant execute on function public.sales_request_additional_month(date,uuid) to authenticated;

-- REVOKE/GRANT от роли, которая не владеет функцией, молча ничего не меняет
-- (CLAUDE.md): проверяем результат.
do $$
begin
 if has_function_privilege('anon','public.sales_request_month_reports(date,uuid)','execute')
  or has_function_privilege('anon','public.sales_request_additional_month(date,uuid)','execute') then
  raise exception 'anon не должен вызывать запросы отчётов продаж';
 end if;
 if not has_function_privilege('authenticated','public.sales_request_month_reports(date,uuid)','execute')
  or not has_function_privilege('authenticated','public.sales_request_additional_month(date,uuid)','execute') then
  raise exception 'authenticated должен вызывать запросы отчётов продаж';
 end if;
end $$;

commit;
