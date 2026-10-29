begin;
create function pg_temp.experience_money_hash(a uuid,v uuid) returns text language sql as $$
 select md5(jsonb_build_object(
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where account_id=a),
  'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id=a),
  'payments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_payments t where venue_id=v),
  'allocations',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_allocations t where venue_id=v),
  'transfers',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_transfers t where venue_id=v),
  'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id=v),
  'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id=v),
  'models',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_models t where venue_id=v),
  'rules',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_rule_versions t where venue_id=v),
  'former_confirmations',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_qualifications t where venue_id=v)
 )::text);
$$;
do $$ declare u uuid;a uuid;v uuid;employee uuid;money_hash text;n integer;history_count integer;begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 if a is null or v is null then raise exception 'Owner fixture is not configured';end if;
 update public.payroll_settings set experience_starts_on=null,experience_policy_version=0,
  experience_policy_request_key=null,experience_policy_request_input=null where account_id=a and venue_id=v;
 money_hash:=pg_temp.experience_money_hash(a,v);
 select count(*) into history_count from public.payroll_events where venue_id=v and action='experience_policy';
 n:=public.payroll_set_experience_start('2026-11-10',0,'00000000-0000-4000-8000-000000000201','Начисление с 10 ноября без тестов',v);
 if n<>1 or not exists(select 1 from public.payroll_settings where venue_id=v and experience_starts_on='2026-11-10') then raise exception 'Start date was not saved';end if;
 if pg_temp.experience_money_hash(a,v) is distinct from money_hash then raise exception 'Date setting changed money or preserved history';end if;
 if public.payroll_set_experience_start('2026-11-10',0,'00000000-0000-4000-8000-000000000201','Начисление с 10 ноября без тестов',v)<>1 then raise exception 'Lost-response replay failed';end if;
 if (select count(*) from public.payroll_events where venue_id=v and action='experience_policy')<>history_count+1 then raise exception 'Replay duplicated history';end if;
 begin
  perform public.payroll_set_experience_start('2026-11-11',0,'00000000-0000-4000-8000-000000000201','Начисление с 10 ноября без тестов',v);
  raise exception 'Changed replay accepted';
 exception when raise_exception then if sqlerrm not like 'Ключ запроса уже использован%' then raise;end if;end;
 begin
  perform public.payroll_set_experience_start('2026-11-12',0,'00000000-0000-4000-8000-000000000202','Устаревший просмотр',v);
  raise exception 'Stale write accepted';
 exception when raise_exception then if sqlerrm not like 'Настройки изменились%' then raise;end if;end;
 begin
  perform public.payroll_set_experience_start('2026-11-12',1,'00000000-0000-4000-8000-000000000202','Другое заведение','00000000-0000-4000-8000-000000000203');
  raise exception 'Wrong venue accepted';
 exception when raise_exception then if sqlerrm not like 'Заведение изменилось%' then raise;end if;end;
 if has_function_privilege('anon','public.payroll_set_experience_start(date,integer,uuid,text,uuid)','execute') then raise exception 'Anonymous policy writes allowed';end if;
 select id into employee from public.payroll_employees where account_id=a and venue_id=v limit 1;
 begin
  insert into public.payroll_qualifications(account_id,venue_id,employee_id,valid_from,knowledge,experience,reason)
  values(a,v,employee,'2026-11-10',true,true,'Прежний клиент пытается подтвердить тест');
  raise exception 'Retired tests accepted new data';
 exception when raise_exception then if sqlerrm not like 'Тесты и связанные с ними надбавки больше не используются%' then raise;end if;end;
 insert into public.payroll_source_days(account_id,venue_id,business_date,state,lease_token)
 values(a,v,'2026-10-20','loading','00000000-0000-4000-8000-000000000204')
 on conflict(venue_id,business_date) do update set state='loading',lease_token=excluded.lease_token;
 n:=public.payroll_set_experience_start('2026-10-20',1,'00000000-0000-4000-8000-000000000205','Проверка очереди с откатом',v);
 if n<>2 or not exists(select 1 from public.payroll_source_days where venue_id=v and business_date='2026-10-20' and state='pending' and lease_token is null) then raise exception 'Old worker can still commit a stale policy';end if;
 if pg_temp.experience_money_hash(a,v) is distinct from money_hash then raise exception 'Queueing changed financial data';end if;
 if not exists(select 1 from public.audit_logs where venue_id=v and entity_id=v and user_id=u and action_code='payroll.experience.updated' and details->>'new'='2026-11-10') then raise exception 'Russian audit event missing';end if;
 raise notice 'PASS: exact date, replay, stale write, changed venue, retired tests, revoked worker lease, untouched amounts/rates/history and audit';
end $$;
rollback;
