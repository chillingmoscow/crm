begin;
do $test$
declare u uuid;a uuid;v uuid;m date;job jsonb;first_job jsonb;other_job jsonb;token uuid;before_hash text;after_hash text;before_metrics jsonb;history_count bigint;
begin
 select id into u from auth.users where email='owner@test.com';perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.sales_statistics_sources(account_id,venue_id,alcohol_report_id,regular_guests_report_id,average_check_report_id) values(a,v,197,84,120) on conflict(venue_id) do update set enabled=true;
 select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t))::text) into before_hash;
 m:=(date_trunc('month',now())-interval '1 month')::date;
 begin
  perform public.sales_request_month_reports(m,gen_random_uuid());raise exception 'Changed venue accepted';
 exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 delete from public.sales_month_report_history where venue_id=v;delete from public.sales_month_reports where venue_id=v;
 if private.sales_request_month_reports(v,m,false)<>3 or private.sales_request_month_reports(v,m,false)<>0 then raise exception 'Scheduled request duplicated';end if;
 job:=public.sales_claim_month_report(v);first_job:=job;
 if job is null or job->>'venue_id'<>v::text then raise exception 'Wrong claim scope';end if;
 if public.sales_commit_month_report((job->>'id')::uuid,gen_random_uuid(),'{}') then raise exception 'Foreign lease committed';end if;
 before_metrics:=case job->>'kind' when 'alcohol' then '{"revenue":0}'::jsonb when 'regular_guests' then '{"revenue":120.5,"guests":2}'::jsonb else '{"average":60.25}'::jsonb end;
 if not public.sales_commit_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,before_metrics) then raise exception 'Commit failed';end if;
 select count(*) into history_count from public.sales_month_report_history;
 if not public.sales_commit_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,before_metrics) or (select count(*) from public.sales_month_report_history)<>history_count then raise exception 'Lost response duplicated history';end if;
 perform public.sales_fail_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,'Lost response',null);
 if not exists(select 1 from public.sales_month_reports where id=(job->>'id')::uuid and state='ready' and metrics=before_metrics) then raise exception 'Lost failure response reopened done report';end if;
 perform private.sales_request_month_reports(v,m,true);
 job:=public.sales_claim_month_report(v);
 update public.sales_month_reports set next_retry_at=now()+interval '1 hour' where venue_id=v and id<>(job->>'id')::uuid;
 update public.sales_month_reports set claimed_at=now()-interval '4 minutes' where id=(job->>'id')::uuid;
 other_job:=public.sales_claim_month_report(v);
 if other_job->>'id'<>job->>'id' or other_job->>'lease_token'=job->>'lease_token' then raise exception 'Expired lease not reclaimed';end if;
 if public.sales_commit_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,before_metrics) then raise exception 'Stale worker accepted';end if;
 perform public.sales_fail_month_report((other_job->>'id')::uuid,(other_job->>'lease_token')::uuid,'Provider unavailable',null);
 if not exists(select 1 from public.sales_month_reports where id=(first_job->>'id')::uuid and metrics=before_metrics) then raise exception 'Error discarded prior good metrics';end if;
 perform private.sales_request_month_reports(v,m,true);job:=public.sales_claim_month_report(v);
 begin
  perform public.sales_commit_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,'{"revenue":null,"guests":null,"average":null}');raise exception 'Missing values accepted';
 exception when raise_exception then if sqlerrm not in ('Неверный результат отчёта','Неизвестный показатель не равен нулю') then raise;end if;end;
 update public.sales_statistics_sources set version=version+1 where venue_id=v;
 if public.sales_commit_month_report((job->>'id')::uuid,(job->>'lease_token')::uuid,before_metrics) then raise exception 'Changed source accepted';end if;
 if has_function_privilege('authenticated','public.sales_claim_month_report(uuid)','EXECUTE') or has_table_privilege('authenticated','public.sales_month_reports','UPDATE') or has_function_privilege('anon','public.sales_request_month_reports(date,uuid)','EXECUTE') then raise exception 'Unsafe worker grants';end if;
 select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t))::text) into after_hash;
 if before_hash is distinct from after_hash then raise exception 'Statistics changed finance/payroll';end if;
 raise notice 'PASS: venue-scoped claims, daily dedup, lease/reclaim, atomic replay, source changes, missing values, retained good result, grants and unchanged finance/payroll';
end $test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.sales_month_reports) or exists(select 1 from public.sales_statistics_sources) then raise exception 'Anonymous statistics leak';end if;end $$;
rollback;
