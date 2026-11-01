-- New versions can allocate the shared pool by native departments. Older
-- versions remain immutable and are still validated/calculated as role groups.
-- This migration changes no stored policy, payroll adjustment, or transaction.
begin;
create function private.stock_validate_deduction_roles_v286(c jsonb,a uuid,v uuid) returns void language plpgsql set search_path='' as $$
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
revoke all on function private.stock_validate_deduction_roles_v286(jsonb,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.stock_validate_deduction_rules(c jsonb,a uuid,v uuid)
returns void language plpgsql set search_path='' as $$
declare legacy jsonb; g jsonb; dept text; seen uuid[] := '{}';
begin
 if c is null or jsonb_typeof(c)<>'object' then raise exception 'Проверьте правила удержаний';end if;
 if c->>'distribution'='departments' and (c->>'split' is distinct from 'once') then raise exception 'Распределение на несколько периодов больше не используется';end if;
 if c ? 'excludedDepartmentIds' and (jsonb_typeof(c->'excludedDepartmentIds') is distinct from 'array' or jsonb_array_length(c->'excludedDepartmentIds')>100) then raise exception 'Проверьте исключённые подразделения';end if;
 if jsonb_typeof(c->'groups') is distinct from 'array' then raise exception 'Проверьте группы подразделений';end if;
 legacy := c-'excludedDepartmentIds';
 legacy := jsonb_set(legacy,'{groups}','[]');
 for g in select value from jsonb_array_elements(c->'groups') loop
  if g ? 'departmentIds' and (jsonb_typeof(g->'departmentIds') is distinct from 'array' or jsonb_array_length(g->'departmentIds')>100) then raise exception 'Проверьте подразделения группы';end if;
  if c->>'distribution'='departments' then
   if coalesce(jsonb_array_length(g->'roleIds'),0)>0 or coalesce(jsonb_array_length(c->'excludedRoleIds'),0)>0 then raise exception 'Выберите подразделения вместо должностей';end if;
   if (g->>'share')::numeric>0 and coalesce(jsonb_array_length(g->'departmentIds'),0)=0 then raise exception 'Выберите подразделения для каждой группы с ненулевой долей';end if;
  end if;
  for dept in select value from jsonb_array_elements_text(coalesce(g->'departmentIds','[]')) loop
   if dept!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Проверьте подразделения группы';end if;
   if dept::uuid=any(seen) or not exists(select 1 from public.departments d join public.venues z on z.id=d.venue_id where d.id=dept::uuid and d.venue_id=v and z.account_id=a and d.archived_at is null) then raise exception 'Подразделение повторяется, удалено или относится к другому заведению';end if;
   seen:=array_append(seen,dept::uuid);
  end loop;
  legacy:=jsonb_set(legacy,'{groups}',(legacy->'groups')||jsonb_build_array(g-'departmentIds'));
 end loop;
 for dept in select value from jsonb_array_elements_text(coalesce(c->'excludedDepartmentIds','[]')) loop
  if dept!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Проверьте исключённые подразделения';end if;
  if dept::uuid=any(seen) or not exists(select 1 from public.departments d join public.venues z on z.id=d.venue_id where d.id=dept::uuid and d.venue_id=v and z.account_id=a and d.archived_at is null) then raise exception 'Исключённое подразделение повторяется или недоступно';end if;
  seen:=array_append(seen,dept::uuid);
 end loop;
 if c->>'distribution'='departments' then legacy:=jsonb_set(legacy,'{distribution}','"groups"');end if;
 perform private.stock_validate_deduction_roles_v286(legacy,a,v);
end $$;
revoke all on function private.stock_validate_deduction_rules(jsonb,uuid,uuid) from public,anon,authenticated,service_role;
commit;
