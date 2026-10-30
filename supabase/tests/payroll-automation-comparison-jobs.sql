begin;
do $test$
declare u uuid;a uuid;v uuid;cfg jsonb;job jsonb;reclaimed jsonb;snapshot jsonb;transported jsonb;plan jsonb:='{"decisions":[],"blockers":[],"recordedCandidates":[]}';run uuid;again uuid;old uuid;n integer;before_count bigint;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 -- Keep production-like validated configuration but do not require a saved UI setup.
 cfg:=$cfg${"medical":{"reminders":true,"reminder_after_hire_days":3,"reminder_before_expiry_days":30,"submission_fine":true,"submission_after_hire_months":1,"submission_amount":3000,"expiry_fine":true,"expiry_amount":3000,"expiry_frequency":"once_per_expiry_case","reimbursement":true,"reimbursement_amount":3000,"reimbursement_after_exam_months":3,"reimbursement_requires_exam_after_hire":true},"uniform":{"enabled":true,"installments":4,"payment_days":[3,18]},"tasks":{"missing_enabled":true,"missing_kind":"deduction","missing_amount":200,"extra_reward_enabled":true,"extra_reward_medium":"bonus"},"gifts":{"enabled":false,"tenure_boundary_days":90,"holidays":[],"tenure":[]}}$cfg$::jsonb;
 cfg:=jsonb_set(cfg,'{medical,submission_amount}','3000.00'::jsonb);
 perform public.payroll_save_automation_settings(v,coalesce((select version from public.payroll_automation_settings where venue_id=v),0),cfg);
 update public.payroll_automation_settings_history set updated_at=now()-interval '2 days' where venue_id=v;
 delete from public.payroll_automation_jobs;
 select count(*) into before_count from public.payroll_adjustments;
 n:=public.payroll_schedule_automation_comparisons();
 if n<1 or public.payroll_schedule_automation_comparisons()<>0 then raise exception 'Schedule was duplicated';end if;
 job:=public.payroll_claim_automation_comparison();
 if job is null or job->>'venue_id'<>v::text then raise exception 'No comparison lease';end if;
 snapshot:=public.payroll_automation_snapshot(v);
 transported:=replace(snapshot::text,'"submission_amount": 3000.00','"submission_amount": 3000')::jsonb;
 if transported is distinct from snapshot or md5(transported::text)=md5(snapshot::text) then raise exception 'Decimal transport fixture is ineffective';end if;
 begin
 perform public.payroll_commit_scheduled_automation((job->>'id')::uuid,gen_random_uuid(),snapshot,plan);raise exception 'Wrong lease accepted';
 exception when raise_exception then if sqlerrm not like 'Запуск уже передан%' then raise;end if;end;
 run:=public.payroll_commit_scheduled_automation((job->>'id')::uuid,(job->>'lease_token')::uuid,transported,plan);
 again:=public.payroll_commit_scheduled_automation((job->>'id')::uuid,(job->>'lease_token')::uuid,snapshot,plan);
 if run is distinct from again or not exists(select 1 from public.payroll_automation_jobs where id=(job->>'id')::uuid and state='done' and run_id=run) then raise exception 'Completion not atomic/idempotent';end if;
 if not exists(select 1 from public.payroll_automation_runs where id=run and mode='comparison' and applied_count=0) or (select count(*) from public.payroll_adjustments)<>before_count then raise exception 'Comparison had a financial side effect';end if;
 perform public.payroll_fail_automation_comparison((job->>'id')::uuid,(job->>'lease_token')::uuid);
 if not exists(select 1 from public.payroll_automation_jobs where id=(job->>'id')::uuid and state='done') then raise exception 'Lost response reopened committed result';end if;
 job:=public.payroll_claim_automation_comparison();
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 perform public.payroll_save_automation_settings(v,(select version from public.payroll_automation_settings where venue_id=v),cfg);
 snapshot:=public.payroll_automation_snapshot(v);
 run:=public.payroll_commit_scheduled_automation((job->>'id')::uuid,(job->>'lease_token')::uuid,snapshot,plan);
 if run is not null or not exists(select 1 from public.payroll_automation_jobs where id=(job->>'id')::uuid and state='superseded') then raise exception 'Stale source was used';end if;
 if public.payroll_schedule_automation_comparisons()<1 then raise exception 'Changed source did not schedule new comparison';end if;
 job:=public.payroll_claim_automation_comparison();
 update public.payroll_automation_jobs set next_retry_at=now()+interval '1 hour' where id<>(job->>'id')::uuid and state in ('pending','error');
 update public.payroll_automation_jobs set claimed_at=now()-interval '4 minutes' where id=(job->>'id')::uuid;
 reclaimed:=public.payroll_claim_automation_comparison();
 if reclaimed->>'id'<>job->>'id' or reclaimed->>'lease_token'=job->>'lease_token' then raise exception 'Abandoned job was not reclaimed';end if;
 begin
 perform public.payroll_commit_scheduled_automation((job->>'id')::uuid,(job->>'lease_token')::uuid,snapshot,plan);raise exception 'Superseded worker accepted';
 exception when raise_exception then if sqlerrm not like 'Запуск уже передан%' then raise;end if;end;
 perform public.payroll_fail_automation_comparison((job->>'id')::uuid,(job->>'lease_token')::uuid);
 if not exists(select 1 from public.payroll_automation_jobs where id=(job->>'id')::uuid and state='running' and lease_token=(reclaimed->>'lease_token')::uuid) then raise exception 'Old worker changed new lease';end if;
 perform public.payroll_commit_scheduled_automation((reclaimed->>'id')::uuid,(reclaimed->>'lease_token')::uuid,snapshot,plan);
 insert into public.payroll_automation_jobs(account_id,venue_id,business_date,fingerprint) values(a,v,current_date-9,'expired') returning id into old;
 perform public.payroll_claim_automation_comparison();
 if not exists(select 1 from public.payroll_automation_jobs where id=old and state='review') then raise exception 'Old failed day silently retried forever';end if;
 if has_function_privilege('authenticated','public.payroll_schedule_automation_comparisons()','EXECUTE') or has_table_privilege('authenticated','public.payroll_automation_jobs','UPDATE') then raise exception 'Browser can run the system worker';end if;
 raise notice 'PASS: daily deduplication, exact lease, atomic replay, stale sources, reclaim, no financial effects and archived-day review';
end $test$;
rollback;
