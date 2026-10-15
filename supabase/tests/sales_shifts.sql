-- Integration regression: authorization, atomic edits, conflicts, preserved baselines and worker fencing.
-- Only local seed users; changes roll back.
begin;
do $$
declare owner_id uuid; waiter_id uuid; venue uuid; account uuid; d uuid; j uuid; claim jsonb; result jsonb; n integer;
begin
 select id into owner_id from auth.users where email='owner@test.com';
 select id into waiter_id from auth.users where email='waiter@test.com';
 if owner_id is null or waiter_id is null then raise exception 'Требуются локальные seed-пользователи';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('app.ctx_ready','0',true);
 venue:=public.get_active_venue_id();account:=public.get_active_account_id();
 if not public.has_permission('sales.configure_shifts') then raise exception 'Владелец не получил права';end if;
 insert into public.sales_settings(venue_id,account_id) values(venue,account) on conflict do nothing;
 n:=public.sales_import_history(venue,account,'[{"date":"2031-01-02","source_id":"regression","metrics":{"turnover":100,"hookah":40,"bar":60,"tips_total":12}}]');
 select id into d from public.sales_days where venue_id=venue and business_date='2031-01-02';
 result:=public.sales_adjust(d,1,'{"turnover":123}','Коррекция регрессии','Проверка');
 if result->'overrides'->>'turnover'<>'123' or result->'calculated'->>'turnover'<>'100' then raise exception 'Исходное значение потеряно';end if;
 begin perform public.sales_adjust(d,1,'{"taxi":10}','Повторная запись',null);raise exception 'stale-version-accepted';exception when others then if sqlerrm='stale-version-accepted' then raise;end if;end;
 begin perform public.sales_adjust(d,2,'{"taxi":10,"checks":-1}','Некорректная запись',null);raise exception 'invalid-value-accepted';exception when others then if sqlerrm='invalid-value-accepted' then raise;end if;end;
 if (select overrides ? 'taxi' from public.sales_days where id=d) then raise exception 'Частичное исправление опубликовано';end if;
 perform public.sales_import_history(venue,account,'[{"date":"2031-01-02","source_id":"regression-v2","metrics":{"turnover":101}}]');
 if (select calculated->>'turnover' from public.sales_days where id=d)<>'100' then raise exception 'Повторный импорт затёр расчёт';end if;
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,created_at,priority) values(account,venue,'2031-01-02','1900-01-01',10) returning id into j;
 update public.sales_settings set provider_retry_at=now()+interval '1 minute' where account_id=account;
 claim:=public.sales_claim_job();
 if claim->>'account_id'=account::text then raise exception 'Пауза подключения проигнорирована';end if;
 update public.sales_settings set provider_retry_at=now()-interval '1 second' where account_id=account;
 claim:=public.sales_claim_job();
 if claim->>'id'<>j::text or claim is null then raise exception 'Очередь не продолжилась после паузы';end if;
 begin perform public.sales_save_slice(j,gen_random_uuid(),'{}','[]');raise exception 'stale-lease-accepted';exception when others then if sqlerrm='stale-lease-accepted' then raise;end if;end;
 perform public.sales_save_slice(j,(claim->>'lease_token')::uuid,'{"phase":"commit","cursor":1}','[{"order_id":1,"order_data":{"id":1},"detail_data":{"id":1}}]');
 if (select count(*) from public.sales_sync_receipts where job_id=j)<>1 or (select phase from public.sales_sync_jobs where id=j)<>'commit' then raise exception 'Срез не сохранён атомарно';end if;
 update public.sales_sync_jobs set status='running',lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes' where id=j returning to_jsonb(sales_sync_jobs.*) into claim;
 perform public.sales_commit_job(j,(claim->>'lease_token')::uuid,'{"turnover":150,"hookah":40,"bar":110,"tips":10,"service":2,"tips_total":12,"parking":0,"taxi":0,"checks":1,"staff_checks":0,"deposits":0}','{}',true);
 if (select overrides->>'turnover' from public.sales_days where id=d)<>'123' or (select legacy->>'turnover' from public.sales_days where id=d)<>'101' then raise exception 'Синхронизация затёрла исправления или Glide';end if;
 if not exists(select 1 from public.sales_sync_receipts where job_id=j) then raise exception 'Нет исходных данных расчёта';end if;
 result:=public.sales_adjust(d,4,'{"turnover":null}','Вернуть исходное',null);
 if result->'overrides' ? 'turnover' then raise exception 'Исправление не отменено';end if;
 perform set_config('request.jwt.claim.sub',waiter_id::text,true);perform set_config('app.ctx_ready','0',true);
 begin perform public.sales_adjust(d,5,'{"turnover":1}','Нет доступа',null);raise exception 'employee-adjust-accepted';exception when others then if sqlerrm='employee-adjust-accepted' then raise;end if;end;
 perform set_config('sales.test.day',d::text,true);
 raise notice 'PASS: edits, versions, import, source preservation, queue fencing, employee authorization';
end $$;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.sales_days where id=current_setting('sales.test.day')::uuid) then raise exception 'Сотрудник видит финансовые смены без права';end if;
 begin perform 1 from public.sales_sync_receipts;raise exception 'raw-receipts-visible';exception when insufficient_privilege then null;end;
 raise notice 'PASS: RLS and inaccessible raw source snapshots';
end $$;
rollback;
