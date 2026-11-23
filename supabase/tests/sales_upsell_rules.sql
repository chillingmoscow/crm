-- ============================================================
-- sales_upsell_rules.sql — правила допродаж по подразделениям (миграция 380):
-- валидатор строк, сохранение версии, очередь дней, захват/фиксация/ошибка,
-- права и RLS.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   pnpm db:reset
--   docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - \
--     < supabase/tests/sales_upsell_rules.sql
--
-- Всё в одной транзакции с ROLLBACK в конце — тестовые данные не остаются.
-- ON_ERROR_STOP обязателен: без него упавший ассерт не останавливает psql,
-- и финальное сообщение печатается уже вне aborted-транзакции.
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- ────────────────────────────────────────────────────────────
-- 0. Окружение: владелец seed-аккаунта, продажи заведения, подразделения.
-- ────────────────────────────────────────────────────────────
do $$
declare u uuid;a uuid;v uuid;bar uuid;old_dep uuid;cutoff date;
begin
 select id into u from auth.users where email='owner@test.com';
 if u is null then raise exception 'TEST SETUP: seed owner@test.com is missing';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 if a is null or v is null then raise exception 'TEST SETUP: owner has no active account/venue';end if;
 insert into public.sales_settings(venue_id,account_id,enabled) values(v,a,true)
 on conflict(venue_id) do update set enabled=true;
 insert into public.departments(name,venue_id) values('Бар (тест допродаж)',v) returning id into bar;
 insert into public.departments(name,venue_id,archived_at) values('Архив (тест допродаж)',v,now()) returning id into old_dep;
 select ((now() at time zone timezone)-make_interval(hours=>day_start_hour))::date into cutoff from public.sales_settings where venue_id=v;
 perform set_config('test.owner',u::text,true);perform set_config('test.account',a::text,true);perform set_config('test.venue',v::text,true);
 perform set_config('test.bar',bar::text,true);perform set_config('test.archived',old_dep::text,true);perform set_config('test.cutoff',cutoff::text,true);
end $$;

-- ────────────────────────────────────────────────────────────
-- 1. Валидатор строк правил.
-- ────────────────────────────────────────────────────────────
do $$
declare
 good jsonb:='[{"target":"dish","external_id":"101","name":"Мохито","rate":50},
               {"target":"dish_group","external_id":"7","name":"Коктейли","rate":25.5},
               {"target":"modifier","external_id":"2022","name":"Двойной","rate":0},
               {"target":"modifier_group","external_id":"9","name":"Сиропы","rate":1000000}]';
 bad jsonb;msg text;
begin
 perform private.sales_validate_upsell_lines(good);
 perform private.sales_validate_upsell_lines('[]');
 foreach bad in array array[
  '[{"target":"dish","external_id":"1","name":"А","rate":1},{"target":"dish","external_id":"1","name":"Б","rate":2}]'::jsonb, -- повтор цели
  '[{"target":"ingredient","external_id":"1","name":"Лёд","rate":1}]',                       -- не та цель
  '[{"target":"dish","external_id":"1","name":"А","rate":-1}]',                               -- отрицательная ставка
  '[{"target":"dish","external_id":"1","name":"А","rate":1.005}]',                            -- больше двух знаков
  '[{"target":"dish","external_id":"1","name":"","rate":1}]',                                 -- пустое имя
  '[{"target":"dish","external_id":"1","name":"   ","rate":1}]',                              -- имя из пробелов
  '[{"target":"dish","external_id":"1","name":"А","rate":1000000.01}]',                       -- выше потолка
  '[{"target":"dish","external_id":"12a","name":"А","rate":1}]',                              -- код не из цифр
  '[{"target":"dish","external_id":1,"name":"А","rate":1}]',                                  -- код не строка
  '[{"target":"dish","external_id":"1","name":"А","rate":"1"}]',                              -- ставка не число
  '[{"target":"dish","external_id":"1","name":"А","rate":1,"extra":true}]',                   -- лишний ключ
  '[{"target":"dish","external_id":"1","name":"А"}]',                                         -- нет ставки
  '{"target":"dish"}',                                                                        -- не массив
  'null'
 ] loop
  begin
   perform private.sales_validate_upsell_lines(bad);
   raise exception 'TEST FAILED: validator accepted %',bad;
  exception when raise_exception then
   get stacked diagnostics msg=message_text;
   if msg like 'TEST FAILED%' then raise;end if;
  end;
 end loop;
 begin
  perform private.sales_validate_upsell_lines((select jsonb_agg(jsonb_build_object('target','dish','external_id',i::text,'name','x','rate',1)) from generate_series(1,501) i));
  raise exception 'TEST FAILED: validator accepted 501 lines';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg like 'TEST FAILED%' then raise;end if;end;
 perform private.sales_validate_upsell_lines((select jsonb_agg(jsonb_build_object('target','dish','external_id',i::text,'name','x','rate',1)) from generate_series(1,500) i));
end $$;

-- ────────────────────────────────────────────────────────────
-- 2. Сохранение версии: права, заведение, подразделение, дата, версия, журнал.
-- ────────────────────────────────────────────────────────────
do $$
declare v uuid:=current_setting('test.venue')::uuid;bar uuid:=current_setting('test.bar')::uuid;cutoff date:=current_setting('test.cutoff')::date;
 l jsonb:='[{"target":"dish","external_id":"101","name":"Мохито","rate":50}]';r uuid;r2 uuid;msg text;lg record;
begin
 begin perform public.sales_save_upsell_rules(gen_random_uuid(),bar,0,cutoff+1,l,'Тест');raise exception 'TEST FAILED: foreign venue accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Заведение изменилось%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,current_setting('test.archived')::uuid,0,cutoff+1,l,'Тест');raise exception 'TEST FAILED: archived department accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Подразделение%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,gen_random_uuid(),0,cutoff+1,l,'Тест');raise exception 'TEST FAILED: unknown department accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Подразделение%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,bar,0,cutoff,l,'Тест');raise exception 'TEST FAILED: closed day accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Новые правила%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,bar,0,cutoff+367,l,'Тест');raise exception 'TEST FAILED: far future accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Новые правила%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,bar,0,cutoff+1,l,null);raise exception 'TEST FAILED: empty reason accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Укажите причину%' then raise;end if;end;
 begin perform public.sales_save_upsell_rules(v,bar,0,cutoff+1,'[{"target":"ingredient","external_id":"1","name":"Лёд","rate":1}]','Тест');raise exception 'TEST FAILED: invalid lines accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg like 'TEST FAILED%' then raise;end if;end;
 if exists(select 1 from public.sales_upsell_departments where department_id=bar) then raise exception 'TEST FAILED: refused save created participation';end if;
 -- первое сохранение создаёт участие
 r:=public.sales_save_upsell_rules(v,bar,0,cutoff+1,l,'  Первая версия  ');
 if (select version from public.sales_upsell_departments where department_id=bar)<>1 then raise exception 'TEST FAILED: first save version is not 1';end if;
 if not exists(select 1 from public.sales_upsell_rules where id=r and department_id=bar and valid_from=cutoff+1 and lines=l and reason='Первая версия' and created_by=current_setting('test.owner')::uuid) then raise exception 'TEST FAILED: rule row';end if;
 select * into lg from public.audit_logs where entity_id=r and action_code='sales.additional_rules.updated';
 if not found or lg.details->>'department_id'<>bar::text or lg.details->>'department_name'<>'Бар (тест допродаж)' or (lg.details->>'valid_from')::date<>cutoff+1 or lg.details->>'reason'<>'Первая версия' or lg.details->'lines'<>l
  or (select array_agg(k order by k) from jsonb_object_keys(lg.details) k)<>array['department_id','department_name','lines','reason','valid_from'] then raise exception 'TEST FAILED: audit row %',to_jsonb(lg);end if;
 -- устаревший редактор
 begin perform public.sales_save_upsell_rules(v,bar,0,cutoff+2,l,'Устаревший');raise exception 'TEST FAILED: stale first save accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Правила изменились%' then raise;end if;end;
 r2:=public.sales_save_upsell_rules(v,bar,1,cutoff+2,l,'Вторая версия');
 if (select version from public.sales_upsell_departments where department_id=bar)<>2 then raise exception 'TEST FAILED: second save did not bump version';end if;
 begin perform public.sales_save_upsell_rules(v,bar,1,cutoff+2,l,'Устаревший');raise exception 'TEST FAILED: stale save accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg not like 'Правила изменились%' then raise;end if;end;
end $$;

-- ────────────────────────────────────────────────────────────
-- 3. Очередь дня: незакрытый день, день без версии, новый job, ready без
--    изменений, захват/фиксация/ошибка, устаревшие версия и job, каталог.
-- ────────────────────────────────────────────────────────────
do $$
declare a uuid:=current_setting('test.account')::uuid;v uuid:=current_setting('test.venue')::uuid;bar uuid:=current_setting('test.bar')::uuid;cutoff date:=current_setting('test.cutoff')::date;
 d date;rule uuid;j1 uuid;j2 uuid;job jsonb;job2 jsonb;res jsonb;dr public.sales_upsell_days;msg text;bad jsonb;cat timestamptz;
begin
 -- позавчера: конец этого рабочего дня заведомо раньше «now() - 3 часа»,
 -- поэтому загрузки ниже — загрузки завершённого дня (см. блок 3a)
 d:=cutoff-2;
 -- историческая версия (сохранение задним числом через RPC запрещено)
 insert into public.sales_upsell_rules(account_id,venue_id,department_id,valid_from,lines,reason)
 values(a,v,bar,cutoff-10,'[{"target":"dish","external_id":"101","name":"Мохито","rate":50},{"target":"dish_group","external_id":"7","name":"Коктейли","rate":25}]','История') returning id into rule;
 if private.sales_request_upsell_day(bar,cutoff,false)<>0 then raise exception 'TEST FAILED: open day queued';end if;
 if private.sales_request_upsell_day(bar,cutoff-11,false)<>0 then raise exception 'TEST FAILED: day before first version queued';end if;
 if exists(select 1 from public.sales_upsell_days where department_id=bar) then raise exception 'TEST FAILED: rows for skipped days';end if;
 -- чеков ещё нет: строка встаёт в очередь без job
 if private.sales_request_upsell_day(bar,d,false)<>1 then raise exception 'TEST FAILED: closed day not queued';end if;
 if private.sales_request_upsell_day(bar,d,false)<>0 then raise exception 'TEST FAILED: duplicate request re-queued';end if;
 select * into dr from public.sales_upsell_days where department_id=bar and business_date=d;
 if dr.state<>'pending' or dr.rule_id<>rule or dr.job_id is not null or dr.account_id<>a or dr.venue_id<>v then raise exception 'TEST FAILED: queued row %',to_jsonb(dr);end if;
 -- загрузка чеков дня; провалившиеся и более ранние не считаются
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at) values(a,v,d,'success',now()-interval '3 hours',now()-interval '2 hours') returning id into j1;
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at) values(a,v,d,'failed',now()-interval '1 hour',now()-interval '30 minutes');
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at) values(a,v,d-1,'success',now()-interval '1 hour',now()-interval '30 minutes');
 job:=public.sales_claim_upsell_day();
 if job is null or (job->>'id')::uuid<>dr.id or (job->>'department_id')::uuid<>bar or (job->>'date')::date<>d or (job->>'rule_id')::uuid<>rule or job->'lines'<>(select lines from public.sales_upsell_rules where id=rule) or job->>'lease_token' is null then raise exception 'TEST FAILED: claim %',job;end if;
 if public.sales_claim_upsell_day() is not null then raise exception 'TEST FAILED: running row claimed twice';end if;
 res:='{"bonus":125,"lines":[{"key":"dish:101","quantity":2,"amount":100},{"key":"dish_group:7","quantity":1,"amount":25}],"paid":{"dish:101":"dish:101","dish:102":"dish_group:7"},"unknown":[]}';
 -- чужой lease
 if public.sales_commit_upsell_day((job->>'id')::uuid,gen_random_uuid(),j1,now(),res) then raise exception 'TEST FAILED: foreign lease accepted';end if;
 -- форма результата
 foreach bad in array array[
  res-'paid',
  res||'{"extra":1}',
  jsonb_set(res,'{bonus}','125.5'),
  jsonb_set(res,'{bonus}','"125"'),
  jsonb_set(res,'{bonus}','1e13'),
  jsonb_set(res,'{bonus}','-1'),
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":-2,"amount":100},{"key":"dish_group:7","quantity":1,"amount":25}]'),
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":2,"amount":-100},{"key":"dish_group:7","quantity":1,"amount":25}]'),
  jsonb_set(res,'{unknown}','[{"key":"?:5","quantity":-1}]'),
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":2,"amount":100}]'),                                                                   -- не хватает строки версии
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":2,"amount":100},{"key":"dish_group:7","quantity":1,"amount":25},{"key":"dish:5","quantity":1,"amount":1}]'), -- лишняя
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":2,"amount":100},{"key":"dish:101","quantity":1,"amount":25}]'),                      -- повтор вместо строки
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":"2","amount":100},{"key":"dish_group:7","quantity":1,"amount":25}]'),
  jsonb_set(res,'{lines}','[{"key":"dish:101","quantity":2},{"key":"dish_group:7","quantity":1,"amount":25}]'),
  jsonb_set(res,'{paid}','{"dish:101":1}'),
  jsonb_set(res,'{paid}','[]'),
  jsonb_set(res,'{unknown}','[{"key":"?:5"}]'),
  jsonb_set(res,'{unknown}','[{"key":5,"quantity":1}]'),
  jsonb_set(res,'{unknown}','{}')
 ] loop
  begin
   perform public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j1,now(),bad);
   raise exception 'TEST FAILED: commit accepted %',bad;
  exception when raise_exception then get stacked diagnostics msg=message_text;if msg like 'TEST FAILED%' then raise;end if;end;
 end loop;
 begin perform public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,null,now(),res);raise exception 'TEST FAILED: commit without job accepted';
 exception when raise_exception then get stacked diagnostics msg=message_text;if msg like 'TEST FAILED%' then raise;end if;end;
 cat:=now()-interval '1 day';
 if not public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j1,cat,res) then raise exception 'TEST FAILED: commit refused';end if;
 select * into dr from public.sales_upsell_days where department_id=bar and business_date=d;
 if dr.state<>'ready' or dr.result<>res or dr.job_id<>j1 or dr.catalog_at<>cat or dr.computed_at is null or dr.last_error is not null then raise exception 'TEST FAILED: committed row %',to_jsonb(dr);end if;
 -- потерянный ответ: повтор той же фиксации — true, fail не трогает ready
 if not public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j1,cat,res) then raise exception 'TEST FAILED: replayed commit refused';end if;
 perform public.sales_fail_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,'Lost response');
 if (select state from public.sales_upsell_days where id=dr.id)<>'ready' then raise exception 'TEST FAILED: fail reopened ready row';end if;
 -- ready без изменений не трогается (unknown пуст, каталог новее — неважно)
 if private.sales_request_upsell_day(bar,d,false)<>0 then raise exception 'TEST FAILED: unchanged ready row re-queued';end if;
 if (select state from public.sales_upsell_days where id=dr.id)<>'ready' then raise exception 'TEST FAILED: ready row changed';end if;
 -- Review Focus 4: чеки дня перезагрузили → новый успешный job → день в очередь
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at) values(a,v,d,'success',now()-interval '20 minutes',now()-interval '10 minutes') returning id into j2;
 if private.sales_request_upsell_day(bar,d,false)<>1 then raise exception 'TEST FAILED: new job did not re-queue';end if;
 select * into dr from public.sales_upsell_days where id=dr.id;
 if dr.state<>'pending' or dr.job_id<>j2 or dr.result<>res or dr.attempts<>0 then raise exception 'TEST FAILED: re-queued row %',to_jsonb(dr);end if;
 -- фиксация на устаревшем job отклоняется и возвращает день в очередь
 job:=public.sales_claim_upsell_day();
 if public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j1,cat,res) then raise exception 'TEST FAILED: stale job accepted';end if;
 select * into dr from public.sales_upsell_days where id=dr.id;
 if dr.state<>'error' or dr.result<>res or dr.next_retry_at>now() then raise exception 'TEST FAILED: stale job row %',to_jsonb(dr);end if;
 -- устаревший воркер после перехвата просроченной аренды
 job:=public.sales_claim_upsell_day();
 update public.sales_upsell_days set claimed_at=now()-interval '4 minutes' where id=dr.id;
 job2:=public.sales_claim_upsell_day();
 if job2->>'id'<>job->>'id' or job2->>'lease_token'=job->>'lease_token' then raise exception 'TEST FAILED: expired lease not reclaimed';end if;
 if public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j2,cat,res) then raise exception 'TEST FAILED: stale worker accepted';end if;
 -- ошибка подсчёта: бэкофф, текст ошибки
 perform public.sales_fail_upsell_day((job2->>'id')::uuid,(job2->>'lease_token')::uuid,'Чеки дня ещё не загружены');
 select * into dr from public.sales_upsell_days where id=dr.id;
 if dr.state<>'error' or dr.last_error<>'Чеки дня ещё не загружены' or dr.next_retry_at<=now() then raise exception 'TEST FAILED: failed row %',to_jsonb(dr);end if;
 if public.sales_claim_upsell_day() is not null then raise exception 'TEST FAILED: backoff ignored';end if;
 -- принудительный пересчёт
 if private.sales_request_upsell_day(bar,d,true)<>1 then raise exception 'TEST FAILED: force did not re-queue';end if;
 -- версия правил сменилась после захвата → фиксация отклоняется
 job:=public.sales_claim_upsell_day();
 insert into public.sales_upsell_rules(account_id,venue_id,department_id,valid_from,lines,reason,created_at)
 values(a,v,bar,cutoff-5,'[{"target":"dish","external_id":"101","name":"Мохито","rate":60}]','Новее',now()) returning id into rule;
 if public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j2,cat,res) then raise exception 'TEST FAILED: changed rule accepted';end if;
 if (select state from public.sales_upsell_days where id=dr.id)<>'error' then raise exception 'TEST FAILED: changed rule row not in error';end if;
 -- новая версия: результат старой версии не остаётся рядом с новым rule_id
 if private.sales_request_upsell_day(bar,d,false)<>1 then raise exception 'TEST FAILED: changed rule did not re-queue';end if;
 select * into dr from public.sales_upsell_days where id=dr.id;
 if dr.rule_id<>rule or dr.result is not null then raise exception 'TEST FAILED: stale result kept with new rule %',to_jsonb(dr);end if;
 job:=public.sales_claim_upsell_day();
 if (job->>'rule_id')::uuid<>rule then raise exception 'TEST FAILED: claim returned old rule';end if;
 res:='{"bonus":60,"lines":[{"key":"dish:101","quantity":1,"amount":60}],"paid":{"dish:101":"dish:101"},"unknown":[{"key":"?:555","quantity":2}]}';
 if not public.sales_commit_upsell_day((job->>'id')::uuid,(job->>'lease_token')::uuid,j2,cat,res) then raise exception 'TEST FAILED: commit after rule change refused';end if;
 -- позиции не из каталога + каталог обновился → пересчёт; без обновления — нет
 update public.ingredients set synced_at=cat-interval '1 hour' where account_id=a;
 if private.sales_request_upsell_day(bar,d,false)<>0 then raise exception 'TEST FAILED: unknown without catalog refresh re-queued';end if;
 update public.ingredients set synced_at=now() where id=(select id from public.ingredients where account_id=a limit 1);
 if not found then raise exception 'TEST SETUP: seed has no ingredients';end if;
 if private.sales_request_upsell_day(bar,d,false)<>1 then raise exception 'TEST FAILED: catalog refresh did not re-queue unknown day';end if;
 perform set_config('test.day',dr.id::text,true);
end $$;

-- ────────────────────────────────────────────────────────────
-- 3a. Промежуточная загрузка дня (создана до конца рабочего дня, статус тоже
--     success) не считается чеками дня: прибавка ждёт загрузку, созданную
--     после конца дня.
-- ────────────────────────────────────────────────────────────
do $$
declare a uuid:=current_setting('test.account')::uuid;v uuid:=current_setting('test.venue')::uuid;bar uuid:=current_setting('test.bar')::uuid;cutoff date:=current_setting('test.cutoff')::date;
 e date:=cutoff-1;day_end timestamptz;pre uuid;fin uuid;job jsonb;dr public.sales_upsell_days;
begin
 select ((e+1)::timestamp+make_interval(hours=>day_start_hour)) at time zone timezone into day_end from public.sales_settings where venue_id=v;
 if day_end>now() then raise exception 'TEST SETUP: day % is not over yet',e;end if;
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at)
 values(a,v,e,'success',day_end-interval '20 minutes',day_end-interval '15 minutes') returning id into pre;
 if private.sales_upsell_job_for(v,e) is not null then raise exception 'TEST FAILED: preliminary job accepted';end if;
 -- день встаёт в очередь без чеков, захват отдаёт job_id = null
 if private.sales_request_upsell_day(bar,e,false)<>1 then raise exception 'TEST FAILED: closed day not queued';end if;
 select * into dr from public.sales_upsell_days where department_id=bar and business_date=e;
 if dr.job_id is not null then raise exception 'TEST FAILED: preliminary job linked %',to_jsonb(dr);end if;
 job:=public.sales_claim_upsell_day();
 if (job->>'id')::uuid<>dr.id or job->>'job_id' is not null then raise exception 'TEST FAILED: claim with preliminary job %',job;end if;
 -- фиксация на промежуточной загрузке отклоняется
 if public.sales_commit_upsell_day(dr.id,(job->>'lease_token')::uuid,pre,now(),'{"bonus":0,"lines":[{"key":"dish:101","quantity":0,"amount":0}],"paid":{},"unknown":[]}') then
  raise exception 'TEST FAILED: commit on preliminary job accepted';end if;
 -- загрузка, созданная ровно в конце дня, — чеки дня; день пересчитывается
 insert into public.sales_sync_jobs(account_id,venue_id,business_date,status,created_at,finished_at)
 values(a,v,e,'success',day_end,day_end+interval '5 minutes') returning id into fin;
 if private.sales_upsell_job_for(v,e) is distinct from fin then raise exception 'TEST FAILED: final job not accepted';end if;
 if private.sales_request_upsell_day(bar,e,false)<>1 then raise exception 'TEST FAILED: final job did not re-queue';end if;
 select * into dr from public.sales_upsell_days where id=dr.id;
 if dr.state<>'pending' or dr.job_id is distinct from fin then raise exception 'TEST FAILED: row after final job %',to_jsonb(dr);end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 4. Расписание и «Обновить отчёты» за месяц.
-- ────────────────────────────────────────────────────────────
do $$
declare bar uuid:=current_setting('test.bar')::uuid;v uuid:=current_setting('test.venue')::uuid;cutoff date:=current_setting('test.cutoff')::date;n integer;m date;expected integer;
begin
 delete from public.sales_upsell_days where department_id=bar;
 n:=public.sales_schedule_upsell_days();
 if n<>3 or (select count(*) from public.sales_upsell_days where department_id=bar and business_date between cutoff-3 and cutoff-1 and state='pending')<>3 then raise exception 'TEST FAILED: schedule queued % rows',n;end if;
 if public.sales_schedule_upsell_days()<>0 then raise exception 'TEST FAILED: schedule not idempotent';end if;
 m:=date_trunc('month',cutoff-1)::date;
 select count(*) into expected from generate_series(m,(m+interval '1 month'-interval '1 day')::date,interval '1 day') g where g::date<cutoff and g::date>=cutoff-10;
 n:=public.sales_request_additional_month(m,v);
 if n<>expected then raise exception 'TEST FAILED: month request % <> %',n,expected;end if;
 if not exists(select 1 from public.audit_logs where action_code='sales.additional.refresh_requested' and entity_id=v and (details->>'reports')::integer=n) then raise exception 'TEST FAILED: month audit row';end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 5. Права на функции и таблицы.
-- ────────────────────────────────────────────────────────────
do $$
declare f text;r text;t text;p text;
begin
 foreach f in array array['public.sales_schedule_upsell_days()','public.sales_claim_upsell_day()','public.sales_commit_upsell_day(uuid,uuid,uuid,timestamptz,jsonb)','public.sales_fail_upsell_day(uuid,uuid,text)','private.sales_request_upsell_day(uuid,date,boolean)','private.sales_validate_upsell_lines(jsonb)'] loop
  foreach r in array array['anon','authenticated'] loop
   if has_function_privilege(r,f,'execute') then raise exception 'TEST FAILED: % can execute %',r,f;end if;
  end loop;
 end loop;
 if has_function_privilege('anon','public.sales_save_upsell_rules(uuid,uuid,integer,date,jsonb,text)','execute') or not has_function_privilege('authenticated','public.sales_save_upsell_rules(uuid,uuid,integer,date,jsonb,text)','execute') then raise exception 'TEST FAILED: save grants';end if;
 if has_function_privilege('anon','public.sales_request_additional_month(date,uuid)','execute') or not has_function_privilege('authenticated','public.sales_request_additional_month(date,uuid)','execute') then raise exception 'TEST FAILED: month grants';end if;
 foreach t in array array['public.sales_upsell_departments','public.sales_upsell_rules','public.sales_upsell_days'] loop
  foreach p in array array['insert','update','delete','truncate'] loop
   if has_table_privilege('anon',t,p) or has_table_privilege('authenticated',t,p) then raise exception 'TEST FAILED: % on % for client roles',p,t;end if;
  end loop;
  if has_table_privilege('anon',t,'select') or not has_table_privilege('authenticated',t,'select') then raise exception 'TEST FAILED: select grants on %',t;end if;
 end loop;
end $$;

-- ────────────────────────────────────────────────────────────
-- 5a. Подразделение из допродаж не удаляется (FK без каскада), а текст
--     ошибки содержит имя ограничения — по нему deleteDepartment
--     (src/lib/people/department-delete.ts) показывает понятное сообщение.
-- ────────────────────────────────────────────────────────────
do $$
declare c text;m text;
begin
 delete from public.departments where id=current_setting('test.bar')::uuid;
 raise exception 'TEST FAILED: participating department deleted';
exception when foreign_key_violation then
 get stacked diagnostics c=constraint_name,m=message_text;
 if c<>'sales_upsell_departments_department_id_fkey' or position(c in m)=0 then raise exception 'TEST FAILED: unexpected FK % / %',c,m;end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 6. RLS: владелец видит своё заведение, аноним — ничего.
-- ────────────────────────────────────────────────────────────
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.sales_upsell_departments) or not exists(select 1 from public.sales_upsell_rules) or not exists(select 1 from public.sales_upsell_days) then raise exception 'TEST FAILED: owner cannot read own upsell rows';end if;
 if exists(select 1 from public.sales_upsell_days where venue_id<>current_setting('test.venue')::uuid) then raise exception 'TEST FAILED: foreign venue leak';end if;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin
 if exists(select 1 from public.sales_upsell_departments) or exists(select 1 from public.sales_upsell_rules) or exists(select 1 from public.sales_upsell_days) then raise exception 'TEST FAILED: anonymous leak';end if;
end $$;
reset role;

select 'sales_upsell_rules: all assertions passed' as result;

rollback;
