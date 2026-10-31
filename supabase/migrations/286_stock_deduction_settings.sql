begin;
-- Append-only dated policies. Saving settings never posts wages or cash.
create table public.stock_deduction_rules(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 version integer not null check(version>0),valid_from date not null,config jsonb not null,
 reason text not null check(length(trim(reason)) between 1 and 1000),created_by uuid not null references public.profiles(id),actor_name text not null,created_at timestamptz not null default now(),
 unique(venue_id,version),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index stock_deduction_rules_scope on public.stock_deduction_rules(account_id,venue_id,valid_from desc,version desc);
create index stock_deduction_rules_actor on public.stock_deduction_rules(created_by);
alter table public.stock_deduction_rules enable row level security;
revoke all on public.stock_deduction_rules from public,anon,authenticated,service_role;
grant select on public.stock_deduction_rules to authenticated,service_role;
create policy stock_deduction_rules_read on public.stock_deduction_rules for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('inventory.view_results')));
create function private.stock_validate_deduction_rules(c jsonb,a uuid,v uuid) returns void language plpgsql set search_path='' as $$
declare k text;g jsonb;shares numeric:=0;seen uuid[]:='{}';r text;begin
 if c is null or jsonb_typeof(c)<>'object' or not(c ?& array['enabled','companyAllowance','multiplier','ingredientTolerance','distribution','split','inventoryExclusions','roleSpecificCategories','writeoffReasons','excludedRoleIds','groups']) or c-array['enabled','companyAllowance','multiplier','ingredientTolerance','distribution','split','inventoryExclusions','roleSpecificCategories','writeoffReasons','excludedRoleIds','groups']<>'{}'::jsonb or jsonb_typeof(c->'enabled') is distinct from 'boolean' or c->>'distribution' not in ('groups','shifts') or c->>'split' not in ('pending','once','two_months','two_payments') or c->>'distribution' is null or c->>'split' is null then raise exception 'Проверьте правила удержаний';end if;
 foreach k in array array['companyAllowance','ingredientTolerance','multiplier'] loop
  if jsonb_typeof(c->k) is distinct from 'number' or (c->>k)::numeric<0 or (c->>k)::numeric>(case when k='multiplier' then 100 else 100000000 end) or (c->>k)::numeric<>round((c->>k)::numeric,case when k='multiplier' then 4 else 2 end) then raise exception 'Проверьте суммы и коэффициент';end if;
 end loop;
 foreach k in array array['inventoryExclusions','roleSpecificCategories','writeoffReasons'] loop
  if jsonb_typeof(c->k) is distinct from 'array' or jsonb_array_length(c->k)>500 or exists(select 1 from jsonb_array_elements(c->k) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 300) or (select count(*)<>count(distinct lower(normalize(trim(x),NFKC))) from jsonb_array_elements_text(c->k) x) then raise exception 'Проверьте списки исключений, категорий и причин';end if;
 end loop;
 if jsonb_typeof(c->'groups') is distinct from 'array' or jsonb_array_length(c->'groups')>50 or (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(c->'groups') x) then raise exception 'Проверьте группы должностей';end if;
 for g in select value from jsonb_array_elements(c->'groups') loop
  if jsonb_typeof(g)<>'object' or not(g ?& array['id','name','share','roleIds','categories']) or g-array['id','name','share','roleIds','categories']<>'{}'::jsonb or jsonb_typeof(g->'id') is distinct from 'string' or g->>'id'!~'^[a-z0-9_-]{1,64}$' or jsonb_typeof(g->'name') is distinct from 'string' or length(trim(g->>'name')) not between 1 and 300 or jsonb_typeof(g->'share') is distinct from 'number' or (g->>'share')::numeric not between 0 and 100 or (g->>'share')::numeric<>round((g->>'share')::numeric,2) or jsonb_typeof(g->'roleIds') is distinct from 'array' or jsonb_array_length(g->'roleIds')>100 or jsonb_typeof(g->'categories') is distinct from 'array' or jsonb_array_length(g->'categories')>500 then raise exception 'Проверьте группы должностей';end if;
  shares:=shares+(g->>'share')::numeric;
  if exists(select 1 from jsonb_array_elements(g->'categories') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 300) or (select count(*)<>count(distinct lower(normalize(trim(x),NFKC))) from jsonb_array_elements_text(g->'categories') x) then raise exception 'Проверьте категории группы';end if;
  if exists(select 1 from jsonb_array_elements(g->'roleIds') x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Проверьте должности группы';end if;
  for r in select value from jsonb_array_elements_text(g->'roleIds') loop
   if r::uuid=any(seen) or not exists(select 1 from public.roles x join public.venues z on z.id=x.venue_id where x.id=r::uuid and x.venue_id=v and z.account_id=a and x.archived_at is null) then raise exception 'Должность повторяется, удалена или относится к другому заведению';end if;seen:=array_append(seen,r::uuid);
  end loop;
 end loop;
 if jsonb_typeof(c->'excludedRoleIds') is distinct from 'array' or jsonb_array_length(c->'excludedRoleIds')>100 then raise exception 'Проверьте исключённые должности';end if;
 if exists(select 1 from jsonb_array_elements(c->'excludedRoleIds') x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Проверьте исключённые должности';end if;
 for r in select value from jsonb_array_elements_text(c->'excludedRoleIds') loop
  if r::uuid=any(seen) or not exists(select 1 from public.roles x join public.venues z on z.id=x.venue_id where x.id=r::uuid and x.venue_id=v and z.account_id=a and x.archived_at is null) then raise exception 'Исключённая должность повторяется или недоступна';end if;seen:=array_append(seen,r::uuid);
 end loop;
 if c->>'distribution'='groups' and (jsonb_array_length(c->'groups')=0 or shares<>100) then raise exception 'Сумма долей групп должна равняться 100%%';end if;
end $$;
revoke all on function private.stock_validate_deduction_rules(jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function public.stock_save_deduction_rules(p_expected_venue uuid,p_expected_version integer,p_valid_from date,p_config jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();u uuid:=auth.uid();n integer;old public.stock_deduction_rules;found_id uuid;tz text;actor text;begin
 if u is null or a is null or not public.is_account_owner(a) or not public.has_permission('inventory.view_results') then raise exception 'Настройки удержаний доступны владельцу';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=v and account_id=a and archived_at is null;
 if tz is null then raise exception 'Заведение недоступно';end if;
 if p_valid_from is null or p_valid_from<(now() at time zone tz)::date or p_valid_from>((now() at time zone tz)::date+interval '2 years')::date then raise exception 'Новые правила можно назначить с сегодняшней или будущей даты';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 or octet_length(p_config::text)>100000 then raise exception 'Укажите основание изменения правил';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock-deduction-rules:'||v,0));
 select * into old from public.stock_deduction_rules where venue_id=v and account_id=a order by version desc limit 1;n:=coalesce(old.version,0);
 -- Exact retry does not add another rule or audit event, including a lost response.
 if old.config=p_config and old.valid_from=p_valid_from and old.reason=trim(p_reason) and old.created_by=u then return old.id;end if;
 if p_expected_version is distinct from n then raise exception 'Правила изменились. Обновите страницу перед сохранением';end if;
 perform private.stock_validate_deduction_rules(p_config,a,v);
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=u;
 insert into public.stock_deduction_rules(account_id,venue_id,version,valid_from,config,reason,created_by,actor_name) values(a,v,n+1,p_valid_from,p_config,trim(p_reason),u,coalesce(actor,'Пользователь')) returning id into found_id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,v,u,'stock.deductions.rules_saved','venue',v,jsonb_build_object('version',n+1,'valid_from',p_valid_from,'reason',trim(p_reason),'before',old.config,'after',p_config));return found_id;
end $$;
revoke all on function public.stock_save_deduction_rules(uuid,integer,date,jsonb,text) from public,anon,service_role;
grant execute on function public.stock_save_deduction_rules(uuid,integer,date,jsonb,text) to authenticated;
create policy stock_deduction_rules_audit on public.audit_logs as restrictive for select to authenticated using(action_code not like 'stock.deductions.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('inventory.view_results'))));
commit;
