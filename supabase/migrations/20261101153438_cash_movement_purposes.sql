begin;
-- Old versions keep their configured income route. New forms require an explicit purpose.
create or replace function private.cash_movement_validate_config(a uuid,v uuid,c jsonb) returns void language plpgsql set search_path='' as $$
declare k text;s text;part text;x jsonb;ident uuid;begin
 if c is null or jsonb_typeof(c)<>'object' or not(c ?& array['cashAccountId','safeAccountId','operatingAccountId','incomeCategoryId','taxiCategoryId','tipsCategoryId','safePattern','taxiPattern','tipsPattern','lookbackDays','intervalMinutes','autoRead','overrides']) or c-array['cashAccountId','safeAccountId','operatingAccountId','incomeCategoryId','taxiCategoryId','tipsCategoryId','safePattern','taxiPattern','tipsPattern','lookbackDays','intervalMinutes','autoRead','overrides','cashInMode']<>'{}' then raise exception 'Проверьте параметры инкассаций';end if;
 if c ? 'cashInMode' and (jsonb_typeof(c->'cashInMode') is distinct from 'string' or c->>'cashInMode' not in ('review','income')) then raise exception 'Выберите способ обработки внесений';end if;
 foreach k in array array['cashAccountId','safeAccountId','operatingAccountId'] loop
  if jsonb_typeof(c->k) is distinct from 'string' then raise exception 'Выберите счета';end if;ident:=(c->>k)::uuid;
  if not exists(select 1 from public.bank_accounts b where b.id=ident and b.account_id=a and (b.venue_id is null or b.venue_id=v) and b.is_active and b.currency='RUB' and b.deleted_at is null) then raise exception 'Счёт недоступен в заведении';end if;
 end loop;
 if (select count(distinct (c->>q)::uuid) from unnest(array['cashAccountId','safeAccountId','operatingAccountId'])q)<>3 then raise exception 'Касса, сейф и операционный счёт должны отличаться';end if;
 foreach k in array array['incomeCategoryId','taxiCategoryId','tipsCategoryId'] loop
  if k='incomeCategoryId' and c->k='null'::jsonb and c->>'cashInMode'='review' then continue;end if;
  if jsonb_typeof(c->k) is distinct from 'string' then raise exception 'Выберите статьи';end if;
  if not exists(select 1 from public.finance_categories f where f.id=(c->>k)::uuid and f.account_id=a and f.type::text=case when k='incomeCategoryId' then 'income' else 'expense' end and f.archived_at is null) then raise exception 'Статья недоступна или не соответствует виду операции';end if;
 end loop;
 foreach k in array array['safePattern','taxiPattern','tipsPattern'] loop
  s:=c->>k;
  if jsonb_typeof(c->k) is distinct from 'string' or length(s) not between 1 and 200 or translate(regexp_replace(s,'[[:alnum:][:space:]]','','g'),'_-[]|.*','')<>'' or replace(s,'.*','') ~ '[.*]' then raise exception 'Проверьте правило распознавания комментария';end if;
  foreach part in array string_to_array(s,'|') loop if part='' or (length(part)-length(replace(part,'.*','')))/2>1 then raise exception 'Проверьте правило распознавания комментария';end if;end loop;
  perform '' ~* s;
 end loop;
 if jsonb_typeof(c->'autoRead') is distinct from 'boolean' or jsonb_typeof(c->'lookbackDays') is distinct from 'number' or (c->>'lookbackDays')::numeric not between 1 and 90 or (c->>'lookbackDays')::numeric<>trunc((c->>'lookbackDays')::numeric) or jsonb_typeof(c->'intervalMinutes') is distinct from 'number' or (c->>'intervalMinutes')::numeric not between 15 and 1440 or (c->>'intervalMinutes')::numeric<>trunc((c->>'intervalMinutes')::numeric) then raise exception 'Проверьте период и интервал чтения';end if;
 if jsonb_typeof(c->'overrides') is distinct from 'array' or jsonb_array_length(c->'overrides')>1000 or (select count(*)<>count(distinct (q->>'sourceId')::numeric) from jsonb_array_elements(c->'overrides')q) then raise exception 'Повторные или некорректные исключения';end if;
 for x in select value from jsonb_array_elements(c->'overrides') loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['sourceId','date','amountCents','comment','route','reason']) or x-array['sourceId','date','amountCents','comment','route','reason','sourceType','categoryId']<>'{}' or jsonb_typeof(x->'sourceId') is distinct from 'number' or (x->>'sourceId')!~'^[1-9][0-9]*$' or (x->>'sourceId')::numeric>9007199254740991 or jsonb_typeof(x->'amountCents') is distinct from 'number' or (x->>'amountCents')::numeric not between 1 and 100000000000 or (x->>'amountCents')::numeric<>trunc((x->>'amountCents')::numeric) or jsonb_typeof(x->'date') is distinct from 'string' or (x->>'date')::date::text<>x->>'date' or jsonb_typeof(x->'comment') is distinct from 'string' or length(x->>'comment')>2000 or coalesce(x->>'route','') not in ('safe','operating','income','hold') or jsonb_typeof(x->'reason') is distinct from 'string' or length(trim(x->>'reason')) not between 1 and 1000 then raise exception 'Проверьте снимок и основание исключения';end if;
  if x ? 'sourceType' and (jsonb_typeof(x->'sourceType') is distinct from 'string' or x->>'sourceType' not in ('cashIn','cashOut')) then raise exception 'Выберите тип кассовой операции';end if;
  if x->>'route'='income' then
   if x->>'sourceType' is distinct from 'cashIn' or jsonb_typeof(x->'categoryId') is distinct from 'string' then raise exception 'Для поступления выберите внесение и статью дохода';end if;
   if not exists(select 1 from public.finance_categories f where f.id=(x->>'categoryId')::uuid and f.account_id=a and f.type='income' and f.archived_at is null) then raise exception 'Статья поступления недоступна';end if;
  elsif x ? 'categoryId' then raise exception 'Статья применяется только к поступлению';end if;
 end loop;
end $$;

-- Internal guard for new income purposes and reverse transfers. It never posts money.
create function private.cash_movement_route_matches(c jsonb,cfg jsonb,items jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare source_id text;item jsonb;decision jsonb;category text;target text;
begin
 if jsonb_typeof(c->'sourceIds') is distinct from 'array' or jsonb_array_length(c->'sourceIds')<>1
 or jsonb_typeof(c->'sourceIds'->0) is distinct from 'number' then return false;end if;
 source_id:=c->'sourceIds'->>0;
 if source_id!~'^[1-9][0-9]*$' then return false;end if;
 if c->>'type'='income' then
  if right(c->>'key',length(source_id)+8)<>':'||source_id||':income' or c->>'bankAccountId' is distinct from cfg->>'cashAccountId'
   or c->>'toBankAccountId' is not null then return false;end if;
 elsif c->>'type'='transfer' then
  if right(c->>'key',length(source_id)+10)<>':'||source_id||':transfer' or c->>'categoryId' is not null then return false;end if;
 else return false;end if;

 -- Cancellation is checked against the immutable, scoped transaction binding below.
 -- Its former source or manual decision may already be absent from the new snapshot.
 if c->>'mode' in ('cancel','cancelled') then
  return coalesce(case when c->>'type'='income' then c->>'categoryId' is not null else
   (c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'toBankAccountId' in(cfg->>'safeAccountId',cfg->>'operatingAccountId'))
   or(c->>'toBankAccountId'=cfg->>'cashAccountId' and c->>'bankAccountId' in(cfg->>'safeAccountId',cfg->>'operatingAccountId')) end,false);
 end if;
 select value into item from jsonb_array_elements(items) where value->>'id'=source_id;
 if not found then return false;end if;
 select value into decision from jsonb_array_elements(cfg->'overrides') where value->>'sourceId'=source_id;
 if found then
  if coalesce(decision->>'sourceType','cashOut') is distinct from item->>'type'
   or decision->>'date' is distinct from item->>'date'
   or (decision->>'amountCents')::numeric is distinct from (item->>'amountCents')::numeric
   or lower(btrim(decision->>'comment',E' \t\n\r\f'||chr(11))) is distinct from lower(btrim(item->>'comment',E' \t\n\r\f'||chr(11)))
   or decision->>'route'='hold' then return false;end if;
 elsif item->>'comment' ~* 'не\s+(сдел|пров|работ)' then return false;
 end if;

 if item->>'type'='cashIn' then
  if c->>'type'='income' then
   category:=case when decision->>'route'='income' then decision->>'categoryId'
    when decision is null and coalesce(cfg->>'cashInMode','income')='income' then cfg->>'incomeCategoryId' end;
   return coalesce(category is not null and c->>'categoryId'=category,false);
  end if;
  target:=case decision->>'route' when 'safe' then cfg->>'safeAccountId' when 'operating' then cfg->>'operatingAccountId' end;
  return coalesce(target is not null and c->>'bankAccountId'=target and c->>'toBankAccountId'=cfg->>'cashAccountId',false);
 elsif item->>'type'='cashOut' and c->>'type'='transfer' then
  target:=case when decision->>'route'='safe' then cfg->>'safeAccountId'
   when decision->>'route'='operating' then cfg->>'operatingAccountId'
   when decision is null then case when item->>'comment' ~* (cfg->>'safePattern') then cfg->>'safeAccountId' else cfg->>'operatingAccountId' end end;
  return coalesce(target is not null and c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'toBankAccountId'=target,false);
 end if;
 return false;
end $$;
revoke all on function private.cash_movement_route_matches(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.finance_apply_execution(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle:=$old$(jsonb_array_length(c->'sourceIds')=1 and effect_key=prefix||(c->'sourceIds'->>0)||':transfer' and c->>'type'='transfer' and c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'toBankAccountId' in(cfg->>'safeAccountId',cfg->>'operatingAccountId'))
     or(jsonb_array_length(c->'sourceIds')=1 and effect_key=prefix||(c->'sourceIds'->>0)||':income' and c->>'type'='income' and c->>'bankAccountId'=cfg->>'cashAccountId' and c->>'categoryId'=cfg->>'incomeCategoryId')$old$;
 if position(needle in definition)=0 then raise exception 'Financial movement guard changed; review migration';end if;
 definition:=replace(definition,needle,$new$(private.cash_movement_route_matches(c,cfg,fresh->'source'->'items'))$new$);
 execute definition;
end $patch$;
notify pgrst,'reload schema';
commit;
