begin;
-- Private storage: contacts/preferences/history are exposed only through scoped
-- projections. A list-only permission must not reveal detail fields via REST.
create table private.crm_guests (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 qr_id bigint check(qr_id>0),legacy_id text,revision integer not null default 1 check(revision>0),
 source_data jsonb not null default '{}' check(jsonb_typeof(source_data)='object'),local_data jsonb not null default '{}' check(jsonb_typeof(local_data)='object'),
 legacy_data jsonb not null default '{}' check(jsonb_typeof(legacy_data)='object'),archived_at timestamptz,
 created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade,
 unique(venue_id,qr_id),unique(venue_id,legacy_id)
);
create index crm_guests_scope on private.crm_guests(account_id,venue_id,archived_at,id);
create index crm_guests_creator on private.crm_guests(created_by);
create table private.crm_guest_history (
 id bigint generated always as identity primary key,guest_id uuid not null references private.crm_guests(id) on delete cascade,
 account_id uuid not null,venue_id uuid not null,action text not null,revision integer not null,
 before_data jsonb,after_data jsonb,actor_id uuid references public.profiles(id) on delete set null,actor_name text not null,reason text not null default '',created_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_history_guest on private.crm_guest_history(guest_id,id desc);
create index crm_guest_history_actor on private.crm_guest_history(actor_id);
create index crm_guest_history_scope on private.crm_guest_history(account_id,venue_id);
create table private.crm_guest_requests (
 id uuid primary key,account_id uuid not null,venue_id uuid not null,actor_id uuid references public.profiles(id) on delete set null,
 input_hash text not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_requests_actor on private.crm_guest_requests(actor_id);
create index crm_guest_requests_scope on private.crm_guest_requests(account_id,venue_id);
create table private.crm_guest_sources (
 venue_id uuid primary key,account_id uuid not null,provider text not null check(provider~'^[a-f0-9]{64}$'),version integer not null check(version>0),source_hash text not null,facts jsonb not null,groups jsonb not null default '[]',checked_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_sources_scope on private.crm_guest_sources(account_id,venue_id);
create table private.crm_guest_rules (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,version integer not null check(version>0),
 config jsonb not null,reason text not null check(length(trim(reason)) between 1 and 1000),actor_id uuid references public.profiles(id) on delete set null,actor_name text not null,created_at timestamptz not null default now(),
 unique(venue_id,version),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_rules_actor on private.crm_guest_rules(actor_id);
create index crm_guest_rules_scope on private.crm_guest_rules(account_id,venue_id,version desc);
create table private.crm_guest_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,
 state text not null default 'pending' check(state in ('pending','running','done','error')),phase text not null default 'first' check(phase in ('first','verify')),
 cursor integer not null default 0 check(cursor between 0 and 30000),payload jsonb not null default '{"first":[],"second":[]}',request jsonb not null,
 lease uuid,claimed_at timestamptz,attempts integer not null default 0,next_retry_at timestamptz not null default now(),last_error text,
 created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create unique index crm_guest_jobs_live on private.crm_guest_jobs(venue_id) where state in ('pending','running');
create index crm_guest_jobs_due on private.crm_guest_jobs(state,next_retry_at,created_at);
create index crm_guest_jobs_creator on private.crm_guest_jobs(created_by);
create index crm_guest_jobs_scope on private.crm_guest_jobs(account_id,venue_id,created_at desc);
create table private.crm_guest_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,event_key text not null,
 kind text not null check(kind in ('birthday','birthday_upcoming','group')),guest_id uuid references private.crm_guests(id) on delete set null,
 payload jsonb not null,created_at timestamptz not null default now(),unique(venue_id,event_key),
 foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_events_guest on private.crm_guest_events(guest_id);
create index crm_guest_events_scope on private.crm_guest_events(account_id,venue_id,created_at);
create table private.crm_guest_seen_groups (
 account_id uuid not null,venue_id uuid not null,provider text not null,group_id bigint not null,qr_id bigint not null,first_seen_at timestamptz not null default now(),origin text not null,
 primary key(venue_id,provider,group_id,qr_id),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create index crm_guest_seen_groups_scope on private.crm_guest_seen_groups(account_id,venue_id);
do $$declare t text;begin
 foreach t in array array['crm_guests','crm_guest_history','crm_guest_requests','crm_guest_sources','crm_guest_rules','crm_guest_jobs','crm_guest_events','crm_guest_seen_groups'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence private.crm_guest_history_id_seq from public,anon,authenticated,service_role;

create function private.crm_guest_scope(v uuid,writing boolean default false,details boolean default false) returns uuid language plpgsql set search_path='' as $$
declare a uuid:=public.get_active_account_id();begin
 if auth.uid() is null or a is null or not public.has_permission('crm.view_guests') or (writing and not public.has_permission('crm.manage_guests')) or (details and not public.has_permission('crm.view_guest_details')) then raise exception 'Нет доступа к гостям';end if;
 if v is distinct from public.get_active_venue_id() or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) then raise exception 'Заведение изменилось или недоступно';end if;
 return a;
end $$;
revoke all on function private.crm_guest_scope(uuid,boolean,boolean) from public,anon,authenticated,service_role;
create function private.crm_guest_projection(g private.crm_guests,detailed boolean) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',g.id,'revision',g.revision,'qrId',g.qr_id,'legacyId',g.legacy_id,'archived',g.archived_at is not null,'createdAt',g.created_at,'updatedAt',g.updated_at,'data',case when detailed then g.source_data||g.local_data else (g.source_data||g.local_data)-array['contacts','instagram','gender','sociability','personality','hobbies','work','alcohol','channels','benefits','mobility','note'] end)
$$;
revoke all on function private.crm_guest_projection(private.crm_guests,boolean) from public,anon,authenticated,service_role;
create function private.crm_next_birthday(d integer,m integer,since date) returns date language plpgsql immutable set search_path='' as $$
declare y integer;candidate date;begin
 if d is null or m is null then return null;end if;
 for y in extract(year from since)::integer..extract(year from since)::integer+4 loop
  begin candidate:=make_date(y,m,d);exception when datetime_field_overflow then continue;end;
  if candidate>=since then return candidate;end if;
 end loop;return null;
end $$;
revoke all on function private.crm_next_birthday(integer,integer,date) from public,anon,authenticated,service_role;
create function public.crm_guest_list(p_venue uuid,p_search text default '',p_group text default '',p_birthday text default '',p_archived boolean default false,p_page integer default 0,p_size integer default 25,p_sort text default 'name',p_desc boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue);rows jsonb;total bigint;groups jsonb;today date;can_details boolean:=public.has_permission('crm.view_guest_details');begin
 if length(p_search)>120 or length(p_group)>500 or p_birthday not in ('','today','upcoming') or p_page not between 0 and 100000 or p_size not in (25,50,100) or p_sort not in ('name','birthday','group','updated') then raise exception 'Проверьте фильтры гостей';end if;
 select (now() at time zone coalesce(s.timezone,'Europe/Moscow'))::date into today from public.venues v left join public.sales_settings s on s.account_id=v.account_id and s.venue_id=v.id where v.id=p_venue;
 with candidates as(select g.*,g.source_data||g.local_data data from private.crm_guests g where g.account_id=a and g.venue_id=p_venue and (g.archived_at is not null)=p_archived),filtered as(
  select *,private.crm_next_birthday((data->>'day')::integer,(data->>'month')::integer,today) next_birthday from candidates
   where (p_search='' or position(lower(trim(p_search)) in lower(coalesce(data->>'name','')))>0 or (can_details and position(lower(trim(p_search)) in lower(coalesce(data->>'contacts','')))>0)) and (p_group='' or data->>'groupTitle'=p_group)
 ),selected as(select * from filtered where p_birthday='' or (p_birthday='today' and next_birthday=today) or(p_birthday='upcoming' and next_birthday between today and today+14))
 select count(*) into total from selected;
 -- The list deliberately projects no contact/preferences fields.
 with candidates as(select g.*,g.source_data||g.local_data data from private.crm_guests g where g.account_id=a and g.venue_id=p_venue and (g.archived_at is not null)=p_archived),filtered as(
  select *,private.crm_next_birthday((data->>'day')::integer,(data->>'month')::integer,today) next_birthday from candidates
   where (p_search='' or position(lower(trim(p_search)) in lower(coalesce(data->>'name','')))>0 or (can_details and position(lower(trim(p_search)) in lower(coalesce(data->>'contacts','')))>0)) and (p_group='' or data->>'groupTitle'=p_group)
 ),selected as(select * from filtered where p_birthday='' or(p_birthday='today' and next_birthday=today) or(p_birthday='upcoming' and next_birthday between today and today+14)),ordered as(
  select id,row_number()over(order by
   case when not p_desc and p_sort='name' then lower(data->>'name') end asc nulls last,case when p_desc and p_sort='name' then lower(data->>'name') end desc nulls last,
   case when not p_desc and p_sort='group' then lower(data->>'groupTitle') end asc nulls last,case when p_desc and p_sort='group' then lower(data->>'groupTitle') end desc nulls last,
   case when not p_desc and p_sort='birthday' then next_birthday end asc nulls last,case when p_desc and p_sort='birthday' then next_birthday end desc nulls last,
   case when not p_desc and p_sort='updated' then updated_at end asc nulls last,case when p_desc and p_sort='updated' then updated_at end desc nulls last,id) rn from selected
 )select coalesce(jsonb_agg(private.crm_guest_projection(g,false) order by o.rn),'[]') into rows from ordered o join private.crm_guests g on g.id=o.id where o.rn>p_page*p_size and o.rn<=(p_page+1)*p_size;
 select coalesce(jsonb_agg(title order by title),'[]') into groups from(select distinct (source_data||local_data)->>'groupTitle' title from private.crm_guests where account_id=a and venue_id=p_venue and archived_at is null)q where title is not null;
 return jsonb_build_object('venueId',p_venue,'rows',rows,'total',total,'groups',groups,'today',today,'canManage',public.has_permission('crm.manage_guests') and can_details,'canDetails',can_details,'canConfigure',public.is_account_owner(a));
end $$;
revoke all on function public.crm_guest_list(uuid,text,text,text,boolean,integer,integer,text,boolean) from public,anon,service_role;
grant execute on function public.crm_guest_list(uuid,text,text,text,boolean,integer,integer,text,boolean) to authenticated;
create function public.crm_guest_detail(p_venue uuid,p_id uuid,p_before bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue);g private.crm_guests;rows jsonb;detailed boolean:=public.has_permission('crm.view_guest_details');begin
 select * into g from private.crm_guests where account_id=a and venue_id=p_venue and id=p_id;
 if not found then raise exception 'Гость недоступен';end if;
 if p_before is not null and p_before<=0 then raise exception 'Некорректная страница истории';end if;
 select coalesce(jsonb_agg(case when detailed then to_jsonb(h) else to_jsonb(h)-array['before_data','after_data','reason'] end order by h.id desc),'[]') into rows from(select id,action,revision,before_data,after_data,actor_name,reason,created_at from private.crm_guest_history where guest_id=g.id and account_id=a and venue_id=p_venue and(p_before is null or id<p_before) order by id desc limit 21)h;
 return private.crm_guest_projection(g,detailed)||jsonb_build_object('history',rows,'canManage',public.has_permission('crm.manage_guests') and detailed,'canDetails',detailed);
end $$;
revoke all on function public.crm_guest_detail(uuid,uuid,bigint) from public,anon,service_role;
grant execute on function public.crm_guest_detail(uuid,uuid,bigint) to authenticated;

create function private.crm_validate_guest_patch(p jsonb,a uuid,v uuid) returns void language plpgsql set search_path='' as $$
declare k text;x jsonb;begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>50000 or p-array['name','contacts','instagram','gender','groupTitle','discountPercent','day','month','year','regular','recognized','sociability','personality','hobbies','work','alcohol','channels','benefits','mobility','note','photoPath']<>'{}' then raise exception 'Проверьте поля карточки гостя';end if;
 for k,x in select key,value from jsonb_each(p) loop
  if x='null'::jsonb then continue;end if;
  if k in ('day','month','year','discountPercent') then
   if jsonb_typeof(x)<>'number' or (k<>'discountPercent' and (x::text)::numeric<>trunc((x::text)::numeric)) or (k='day' and (x::text)::integer not between 1 and 31) or(k='month' and (x::text)::integer not between 1 and 12) or(k='year' and (x::text)::integer not between 1900 and 2100) or(k='discountPercent' and (x::text)::numeric not between 0 and 100) then raise exception 'Проверьте дату рождения и размер скидки';end if;
  elsif k in ('regular','recognized') then
   if jsonb_typeof(x)<>'boolean' then raise exception 'Проверьте признаки гостя';end if;
  elsif k in ('personality','hobbies','channels','benefits') then
   if jsonb_typeof(x)<>'array' or jsonb_array_length(x)>50 or exists(select 1 from jsonb_array_elements(x)e where jsonb_typeof(e)<>'string' or length(e#>>'{}')>500) then raise exception 'Проверьте список предпочтений гостя';end if;
  else
   if jsonb_typeof(x)<>'string' or length(x#>>'{}')>(case when k in ('name','groupTitle') then 500 when k='photoPath' then 300 else 4000 end) then raise exception 'Проверьте текстовые поля гостя';end if;
   if k='name' and trim(x#>>'{}')='' then raise exception 'Укажите имя гостя';end if;
   if k='photoPath' and ((x#>>'{}')!~('^'||a||'/'||v||'/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$') or not exists(select 1 from storage.objects where bucket_id='crm-guest-photos' and name=x#>>'{}')) then raise exception 'Фотография недоступна в этом заведении';end if;
  end if;
 end loop;
end $$;
revoke all on function private.crm_validate_guest_patch(jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function private.crm_complete_guest_birthday(p_patch jsonb,p_base jsonb)returns jsonb language sql immutable set search_path=''as $$
 select case when p_patch?|array['day','month','year']then p_patch||jsonb_build_object('day',(coalesce(p_base,'{}')||p_patch)->'day','month',(coalesce(p_base,'{}')||p_patch)->'month','year',(coalesce(p_base,'{}')||p_patch)->'year')else p_patch end
$$;
revoke all on function private.crm_complete_guest_birthday(jsonb,jsonb)from public,anon,authenticated,service_role;
create function public.crm_guest_command(p_venue uuid,p_action text,p_id uuid,p_revision integer,p_request uuid,p_patch jsonb,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue,true,true);g private.crm_guests;before_data jsonb;after_data jsonb;actor text;prior private.crm_guest_requests;hash text;result jsonb;changed jsonb;k text;birth date;begin
 if p_request is null or p_action not in ('create','update','archive','restore') or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Укажите действие и основание';end if;
 if p_patch?|array['groupTitle','discountPercent'] then raise exception 'Действующие группа и скидка берутся из Quick Resto';end if;
 perform private.crm_validate_guest_patch(p_patch,a,p_venue);
 hash:=md5(jsonb_build_object('action',p_action,'id',p_id,'revision',p_revision,'patch',p_patch,'reason',trim(p_reason))::text);
 perform pg_advisory_xact_lock(hashtextextended('crm-guest-request:'||p_request,0));
 select * into prior from private.crm_guest_requests where id=p_request;
 if found then
  if prior.account_id<>a or prior.venue_id<>p_venue or prior.actor_id is distinct from auth.uid() or prior.input_hash<>hash then raise exception 'Запрос уже использован для другого изменения';end if;
  return prior.result;
 end if;
 if p_action='create' then
  if p_id is not null or p_revision is distinct from 0 or trim(coalesce(p_patch->>'name',''))='' then raise exception 'Укажите имя нового гостя';end if;
  p_patch:=private.crm_complete_guest_birthday(p_patch,'{}');
  insert into private.crm_guests(account_id,venue_id,local_data,created_by) values(a,p_venue,p_patch,auth.uid()) returning * into g;
  before_data:=null;
 else
  select * into g from private.crm_guests where account_id=a and venue_id=p_venue and id=p_id for update;
  if not found then raise exception 'Гость недоступен';end if;
  if g.revision is distinct from p_revision then raise exception 'Карточка уже изменилась. Обновите её перед сохранением';end if;
  if (p_action='update' and g.archived_at is not null) or(p_action='archive' and g.archived_at is not null) or(p_action='restore' and g.archived_at is null) then raise exception 'Состояние карточки изменилось';end if;
  if p_action in ('archive','restore') and p_patch<>'{}' then raise exception 'Для изменения архива не нужны новые поля';end if;
  before_data:=g.source_data||g.local_data;
  if p_action='update'then p_patch:=private.crm_complete_guest_birthday(p_patch,before_data);end if;
  update private.crm_guests set local_data=case when p_action='update' then local_data||p_patch else local_data end,
   archived_at=case when p_action='archive' then now() when p_action='restore' then null else archived_at end,revision=revision+1,updated_at=now() where id=g.id returning * into g;
 end if;
 after_data:=g.source_data||g.local_data;
 if (after_data->>'day' is null) is distinct from (after_data->>'month' is null) or (after_data->>'year' is not null and after_data->>'day' is null) then raise exception 'Укажите день и месяц рождения вместе';end if;
 if after_data->>'day' is not null then
  begin birth:=make_date(coalesce((after_data->>'year')::integer,2000),(after_data->>'month')::integer,(after_data->>'day')::integer);exception when datetime_field_overflow then raise exception 'Проверьте дату рождения';end;
 end if;
 if trim(coalesce(after_data->>'name',''))='' then raise exception 'Укажите имя гостя';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id=auth.uid();
 insert into private.crm_guest_history(guest_id,account_id,venue_id,action,revision,before_data,after_data,actor_id,actor_name,reason) values(g.id,a,p_venue,p_action,g.revision,before_data,after_data,auth.uid(),coalesce(actor,'Пользователь'),trim(p_reason));
 select coalesce(jsonb_agg(key order by key),'[]') into changed from jsonb_object_keys(coalesce(before_data,'{}')||after_data)key where before_data->key is distinct from after_data->key;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'crm.guest.'||case p_action when 'create' then 'created' when 'update' then 'updated' when 'archive' then 'archived' else 'restored' end,'guest',g.id,jsonb_build_object('name',after_data->>'name','fields',changed,'revision',g.revision));
 result:=jsonb_build_object('id',g.id,'revision',g.revision);
 insert into private.crm_guest_requests(id,account_id,venue_id,actor_id,input_hash,result) values(p_request,a,p_venue,auth.uid(),hash,result);
 return result;
end $$;
revoke all on function public.crm_guest_command(uuid,text,uuid,integer,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.crm_guest_command(uuid,text,uuid,integer,uuid,jsonb,text) to authenticated;
create policy crm_guest_audit_read on public.audit_logs as restrictive for select to authenticated
 using(action_code not like 'crm.guest.%' or(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and(select public.has_permission('crm.view_guests'))));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('crm-guest-photos','crm-guest-photos',false,5242880,array['image/jpeg','image/png','image/webp'])on conflict(id)do nothing;
create policy crm_guest_photo_read on storage.objects for select to authenticated using(bucket_id='crm-guest-photos' and (storage.foldername(name))[1]=(select public.get_active_account_id())::text and (storage.foldername(name))[2]=(select public.get_active_venue_id())::text and(select public.has_permission('crm.view_guests')));
create policy crm_guest_photo_insert on storage.objects for insert to authenticated with check(bucket_id='crm-guest-photos' and (storage.foldername(name))[1]=(select public.get_active_account_id())::text and (storage.foldername(name))[2]=(select public.get_active_venue_id())::text and(select public.has_permission('crm.view_guests')) and(select public.has_permission('crm.view_guest_details')) and(select public.has_permission('crm.manage_guests')));

create function private.crm_guest_enqueue(a uuid,v uuid,u uuid) returns uuid language plpgsql set search_path='' as $$
declare j uuid;r jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended('crm-guest-read:'||v,0));
 select id into j from private.crm_guest_jobs where account_id=a and venue_id=v and state in ('pending','running');if found then return j;end if;
 select jsonb_build_object('timezone',s.timezone,'dayStartHour',s.day_start_hour) into r from public.sales_settings s join public.venues venue_row on venue_row.id=s.venue_id where s.account_id=a and s.venue_id=v and venue_row.archived_at is null;
 if r is null then raise exception 'Сначала настройте подключение заведения';end if;
 insert into private.crm_guest_jobs(account_id,venue_id,request,created_by) values(a,v,r,u) returning id into j;
 return j;
end $$;
revoke all on function private.crm_guest_enqueue(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.crm_guest_request(p_venue uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue);j uuid;begin
 if not public.is_account_owner(a) then raise exception 'Обновление гостей запускает владелец';end if;
 j:=private.crm_guest_enqueue(a,p_venue,auth.uid());
 if not exists(select 1 from public.audit_logs where account_id=a and venue_id=p_venue and action_code='crm.guest.read_requested' and details->>'jobId'=j::text) then
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(a,p_venue,auth.uid(),'crm.guest.read_requested','venue',p_venue,jsonb_build_object('jobId',j));
 end if;return j;
end $$;
revoke all on function public.crm_guest_request(uuid) from public,anon,service_role;
grant execute on function public.crm_guest_request(uuid) to authenticated;
create function public.crm_guest_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.crm_guest_jobs;begin
 select q.* into j from private.crm_guest_jobs q join public.venues v on v.id=q.venue_id and v.account_id=q.account_id left join public.sales_settings s on s.venue_id=v.id
 where v.archived_at is null and(q.state='pending' or(q.state='running' and q.claimed_at<now()-interval '2 minutes')) and q.next_retry_at<=now() and(s.provider_retry_at is null or s.provider_retry_at<=now()) order by q.created_at,q.id for update of q skip locked limit 1;
 if not found then return null;end if;
 update private.crm_guest_jobs set state='running',lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now() where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.crm_guest_claim() from public,anon,authenticated;
grant execute on function public.crm_guest_claim() to service_role;
create function private.crm_guest_groups_valid(groups jsonb)returns void language plpgsql set search_path=''as $$
declare g jsonb;begin
 if groups is null or jsonb_typeof(groups)<>'array'or jsonb_array_length(groups)>500 then raise exception 'Не подтверждены группы гостей';end if;
 if(select count(*)<>count(distinct x->>'id')from jsonb_array_elements(groups)x)then raise exception 'Повторные группы гостей';end if;
 for g in select value from jsonb_array_elements(groups)loop
  if jsonb_typeof(g)<>'object'or not(g?&array['id','title','discountPercent','promotable','threshold'])or g-array['id','title','discountPercent','promotable','threshold']<>'{}'or jsonb_typeof(g->'id')is distinct from 'number'or(g->>'id')!~'^[1-9][0-9]{0,15}$'or(g->>'id')::numeric>9007199254740991 or jsonb_typeof(g->'title')is distinct from 'string'or length(trim(g->>'title'))not between 1 and 500 or jsonb_typeof(g->'discountPercent')is distinct from 'number'or(g->>'discountPercent')::numeric not between 0 and 100 or jsonb_typeof(g->'promotable')is distinct from 'boolean'or jsonb_typeof(g->'threshold')is distinct from 'number'or(g->>'threshold')::numeric not between 0 and 1000000000000 then raise exception 'Некорректные условия группы';end if;
 end loop;
end $$;
revoke all on function private.crm_guest_groups_valid(jsonb)from public,anon,authenticated,service_role;
create function private.crm_guest_facts_valid(f jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb;birth date;begin
 if f is null or jsonb_typeof(f)<>'array' or jsonb_array_length(f)>30000 or octet_length(f::text)>10000000 then raise exception 'Не подтверждён полный список гостей';end if;
 if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(f)) then raise exception 'Повторные ID гостей';end if;
 for x in select value from jsonb_array_elements(f) loop
  if jsonb_typeof(x)<>'object' or not(x?&array['id','name','contacts','groupId','groupTitle','discountPercent','day','month','year','issues']) or x-array['id','name','contacts','groupId','groupTitle','discountPercent','day','month','year','issues']<>'{}' or jsonb_typeof(x->'id') is distinct from 'number' or (x->>'id')!~'^[1-9][0-9]{0,15}$' or (x->>'id')::numeric>9007199254740991 or jsonb_typeof(x->'name') is distinct from 'string' or length(trim(x->>'name')) not between 1 and 500 or (x->'contacts'<>'null' and (jsonb_typeof(x->'contacts')<>'string' or length(x->>'contacts')>4000)) or (x->'groupTitle'<>'null' and (jsonb_typeof(x->'groupTitle')<>'string' or length(x->>'groupTitle')>500)) or (x->'groupId'<>'null' and (jsonb_typeof(x->'groupId')<>'number' or(x->>'groupId')!~'^[1-9][0-9]{0,15}$')) or(x->'discountPercent'<>'null' and(jsonb_typeof(x->'discountPercent')<>'number' or(x->>'discountPercent')::numeric not between 0 and 100)) or (jsonb_typeof(x->'issues') is distinct from 'array' or jsonb_array_length(x->'issues')>10 or exists(select 1 from jsonb_array_elements(x->'issues')i where jsonb_typeof(i)<>'string'or length(i#>>'{}')>300)) then raise exception 'Некорректные поля гостя Quick Resto';end if;
  if (x->>'day' is null) is distinct from(x->>'month' is null) or (x->>'year' is not null and x->>'day' is null) then raise exception 'Неполная дата рождения';end if;
  if x->>'year' is not null and (jsonb_typeof(x->'year')<>'number'or (x->>'year')!~'^\d{4}$' or(x->>'year')::integer not between 1900 and 2100) then raise exception 'Некорректный год рождения';end if;
  if x->>'day' is not null then
   if jsonb_typeof(x->'day')<>'number'or jsonb_typeof(x->'month')<>'number'or(x->>'day')!~'^\d{1,2}$'or(x->>'month')!~'^\d{1,2}$'then raise exception 'Некорректная дата рождения';end if;
   begin birth:=make_date(coalesce((x->>'year')::integer,2000),(x->>'month')::integer,(x->>'day')::integer);exception when invalid_text_representation or datetime_field_overflow then raise exception 'Некорректная дата рождения';end;
  end if;
 end loop;
end $$;
revoke all on function private.crm_guest_facts_valid(jsonb) from public,anon,authenticated,service_role;
create function public.crm_guest_save_slice(p_job uuid,p_lease uuid,p_phase text,p_cursor integer,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j private.crm_guest_jobs;first_sorted jsonb;old_sorted jsonb;begin
 select * into j from private.crm_guest_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение передано другому обработчику';end if;
 if p_phase not in ('first','verify') or p_cursor not between 0 and 30000 or p_payload is null or jsonb_typeof(p_payload)<>'object' or not(p_payload?&array['first','second','provider','groups']) or p_payload-array['first','second','provider','groups','verifiedGroups']<>'{}' or jsonb_typeof(p_payload->'provider') is distinct from 'string' or p_payload->>'provider'!~'^[a-f0-9]{64}$' then raise exception 'Некорректное состояние чтения гостей';end if;
 perform private.crm_guest_groups_valid(p_payload->'groups');
 if j.payload?'groups' and j.payload->'groups' is distinct from p_payload->'groups' then raise exception 'Изменился справочник групп';end if;
 if p_payload?'verifiedGroups' then
  perform private.crm_guest_groups_valid(p_payload->'verifiedGroups');
  if p_payload->'groups' is distinct from p_payload->'verifiedGroups' then raise exception 'Два прохода групп не совпали';end if;
 end if;
 if j.payload?'verifiedGroups' and j.payload->'verifiedGroups' is distinct from p_payload->'verifiedGroups' then raise exception 'Изменился проверенный справочник групп';end if;
 perform private.crm_guest_facts_valid(p_payload->'first');perform private.crm_guest_facts_valid(p_payload->'second');
 if j.payload->>'provider' is not null and j.payload->>'provider' is distinct from p_payload->>'provider' then raise exception 'Подключение изменилось во время чтения';end if;
 if p_phase=j.phase then
  if p_cursor<=j.cursor or p_cursor-j.cursor>500 or jsonb_array_length(p_payload->case when p_phase='first' then 'first' else 'second' end)<>p_cursor then raise exception 'Пропущена страница гостей';end if;
  if p_phase='verify' and p_payload->'first' is distinct from j.payload->'first' then raise exception 'Изменился первый проход гостей';end if;
  if exists(select 1 from jsonb_array_elements(j.payload->case when p_phase='first' then 'first' else 'second' end)with ordinality o(value,n) where p_payload->case when p_phase='first' then 'first' else 'second' end->(n::integer-1) is distinct from value) then raise exception 'Изменились предыдущие страницы гостей';end if;
 elsif j.phase='first' and p_phase='verify' and p_cursor=0 and p_payload->'second'='[]' then
  select coalesce(jsonb_agg(x order by(x->>'id')::bigint),'[]') into first_sorted from jsonb_array_elements(p_payload->'first')x;
  select coalesce(jsonb_agg(x order by(x->>'id')::bigint),'[]') into old_sorted from jsonb_array_elements(j.payload->'first')x;
  if first_sorted is distinct from old_sorted then raise exception 'Неполный первый проход гостей';end if;
 else raise exception 'Некорректный переход чтения гостей';end if;
 update private.crm_guest_jobs set phase=p_phase,cursor=p_cursor,payload=p_payload,state='pending',lease=null,claimed_at=null,next_retry_at=now(),updated_at=now() where id=j.id;
end $$;
revoke all on function public.crm_guest_save_slice(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.crm_guest_save_slice(uuid,uuid,text,integer,jsonb) to service_role;
create function public.crm_guest_publish(p_job uuid,p_lease uuid,p_facts jsonb,p_provider text,p_groups jsonb,p_verified_groups jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.crm_guest_jobs;s private.crm_guest_sources;g private.crm_guests;r jsonb;data jsonb;before_data jsonb;first_sorted jsonb;second_sorted jsonb;hash text;version integer;created_n integer:=0;changed_n integer:=0;begin
 select * into j from private.crm_guest_jobs where id=p_job and state='running' and phase='verify' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;
 if not found then raise exception 'Чтение передано другому обработчику';end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-guest-publish:'||j.venue_id,0));
 perform 1 from public.venues where id=j.venue_id and account_id=j.account_id and archived_at is null for share;if not found then raise exception 'Заведение недоступно';end if;
 if p_provider is distinct from j.payload->>'provider' or p_provider is distinct from private.finance_execution_provider(j.account_id,j.venue_id) then raise exception 'Подключение изменилось до сохранения гостей';end if;
 if not exists(select 1 from public.sales_settings where account_id=j.account_id and venue_id=j.venue_id and timezone=j.request->>'timezone' and day_start_hour=(j.request->>'dayStartHour')::integer) then raise exception 'Настройки источника изменились';end if;
 perform private.crm_guest_facts_valid(p_facts);
 if exists(select 1 from jsonb_array_elements(p_facts)f where (f->>'groupId' is null and(f->>'groupTitle' is not null or f->>'discountPercent' is not null))or(f->>'groupId'is not null and not exists(select 1 from jsonb_array_elements(p_groups)grp where grp->>'id'=f->>'groupId'and grp->'title'=f->'groupTitle'and grp->'discountPercent'=f->'discountPercent')))then raise exception 'Группа и скидка гостя не совпали со справочником';end if;
 perform private.crm_guest_groups_valid(p_groups);
 if p_groups is distinct from p_verified_groups or p_groups is distinct from j.payload->'groups' or (j.cursor>0 and p_verified_groups is distinct from j.payload->'verifiedGroups') then raise exception 'Два прохода групп гостей не совпали';end if;
 select coalesce(jsonb_agg(x order by(x->>'id')::bigint),'[]') into first_sorted from jsonb_array_elements(j.payload->'first')x;
 select coalesce(jsonb_agg(x order by(x->>'id')::bigint),'[]') into second_sorted from jsonb_array_elements(j.payload->'second')x;
 if first_sorted is distinct from second_sorted or first_sorted is distinct from p_facts or j.cursor<>jsonb_array_length(p_facts) then raise exception 'Два прохода гостей не совпали';end if;
 select * into s from private.crm_guest_sources where venue_id=j.venue_id for update;
 if found and s.provider<>p_provider then raise exception 'Источник гостей изменился. Нужна сверка прежних связей';end if;
 if s.version is not null and jsonb_array_length(s.facts)>0 and jsonb_array_length(p_facts)=0 then raise exception 'Пустой источник требует проверки перед заменой базы';end if;
 hash:=md5(jsonb_build_object('provider',p_provider,'facts',p_facts,'groups',p_groups)::text);version:=coalesce(s.version,0)+case when s.source_hash is distinct from hash then 1 else 0 end;
 if s.source_hash is distinct from hash then
  for r in select value from jsonb_array_elements(p_facts) loop
   data:=r-'id';select * into g from private.crm_guests where account_id=j.account_id and venue_id=j.venue_id and qr_id=(r->>'id')::bigint for update;
   if not found then
    insert into private.crm_guests(account_id,venue_id,qr_id,source_data) values(j.account_id,j.venue_id,(r->>'id')::bigint,data) returning * into g;
    insert into private.crm_guest_history(guest_id,account_id,venue_id,action,revision,after_data,actor_name,reason) values(g.id,j.account_id,j.venue_id,'source_created',g.revision,data,'Quick Resto','Первое подтверждённое чтение');created_n:=created_n+1;
   elsif g.source_data is distinct from data then
    before_data:=g.source_data||g.local_data;
    update private.crm_guests set source_data=data,revision=revision+1,updated_at=now() where id=g.id returning * into g;
    insert into private.crm_guest_history(guest_id,account_id,venue_id,action,revision,before_data,after_data,actor_name,reason) values(g.id,j.account_id,j.venue_id,'source_updated',g.revision,before_data,g.source_data||g.local_data,'Quick Resto','Обновление подтверждённого источника');changed_n:=changed_n+1;
   end if;
  end loop;
  -- Absence from a verified full source is visible, while manual archiving and
  -- local preferences remain intact. A later return clears only this marker.
  for g in select * from private.crm_guests where account_id=j.account_id and venue_id=j.venue_id and qr_id is not null and not(source_data?'sourceMissing') and qr_id not in(select (value->>'id')::bigint from jsonb_array_elements(p_facts)) for update loop
   before_data:=g.source_data||g.local_data;
   update private.crm_guests set source_data=source_data||'{"sourceMissing":true}',revision=revision+1,updated_at=now() where id=g.id returning * into g;
   insert into private.crm_guest_history(guest_id,account_id,venue_id,action,revision,before_data,after_data,actor_name,reason) values(g.id,j.account_id,j.venue_id,'source_missing',g.revision,before_data,g.source_data||g.local_data,'Quick Resto','Гостя нет в подтверждённом полном источнике');changed_n:=changed_n+1;
  end loop;
  insert into private.crm_guest_sources(account_id,venue_id,provider,version,source_hash,facts,groups) values(j.account_id,j.venue_id,p_provider,version,hash,p_facts,p_groups)
   on conflict(venue_id) do update set version=excluded.version,source_hash=excluded.source_hash,facts=excluded.facts,groups=excluded.groups,checked_at=now();
  insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details) values(j.account_id,j.venue_id,'crm.guest.source_updated','venue',j.venue_id,jsonb_build_object('version',version,'created',created_n,'changed',changed_n,'rows',jsonb_array_length(p_facts)));
 else update private.crm_guest_sources set checked_at=now() where venue_id=j.venue_id;end if;
 perform private.crm_guest_notify_due(j.account_id,j.venue_id);
 update private.crm_guest_jobs set state='done',lease=null,claimed_at=null,last_error=null,payload='{}',updated_at=now() where id=j.id;
 return jsonb_build_object('created',created_n,'changed',changed_n,'version',version,'rows',jsonb_array_length(p_facts));
end $$;
revoke all on function public.crm_guest_publish(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_guest_publish(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;
create function public.crm_guest_fail(p_job uuid,p_lease uuid,p_message text,p_retry_seconds integer default null) returns void language plpgsql security definer set search_path='' as $$
declare j private.crm_guest_jobs;begin
 select * into j from private.crm_guest_jobs where id=p_job and state='running' and lease=p_lease and claimed_at>now()-interval '2 minutes' for update;if not found then return;end if;
 update private.crm_guest_jobs set state=case when p_retry_seconds is not null then 'pending' else 'error' end,lease=null,claimed_at=null,last_error=left(p_message,1000),next_retry_at=now()+make_interval(secs=>greatest(30,least(900,coalesce(p_retry_seconds,60)))),updated_at=now() where id=j.id;
 if p_retry_seconds is not null then update public.sales_settings set provider_retry_at=greatest(coalesce(provider_retry_at,now()),now()+make_interval(secs=>greatest(30,least(900,p_retry_seconds)))) where account_id=j.account_id;end if;
end $$;
revoke all on function public.crm_guest_fail(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.crm_guest_fail(uuid,uuid,text,integer) to service_role;

create function public.crm_guest_configuration(p_venue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue);versions jsonb;source private.crm_guest_sources;j private.crm_guest_jobs;begin
 if not public.is_account_owner(a) then raise exception 'Правила гостей изменяет владелец';end if;
 select coalesce(jsonb_agg(to_jsonb(r)order by version desc),'[]') into versions from(select id,version,config,reason,actor_name,created_at from private.crm_guest_rules where account_id=a and venue_id=p_venue order by version desc limit 1000)r;
 if jsonb_array_length(versions)>=1000 then raise exception 'Не удалось подтвердить полную историю правил';end if;
 select * into source from private.crm_guest_sources where account_id=a and venue_id=p_venue;
 select * into j from private.crm_guest_jobs where account_id=a and venue_id=p_venue order by created_at desc,id desc limit 1;
 return jsonb_build_object('venueId',p_venue,'versions',versions,'groups',coalesce(source.groups,'[]'),'checkedAt',source.checked_at,'rows',coalesce(jsonb_array_length(source.facts),0),'job',case when j.id is null then null else jsonb_build_object('state',j.state,'phase',j.phase,'cursor',j.cursor,'error',j.last_error)end);
end $$;
revoke all on function public.crm_guest_configuration(uuid) from public,anon,service_role;
grant execute on function public.crm_guest_configuration(uuid) to authenticated;
create function public.crm_guest_save_rules(p_venue uuid,p_version integer,p_config jsonb,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=private.crm_guest_scope(p_venue);old private.crm_guest_rules;source private.crm_guest_sources;actor text;rid uuid;k text;begin
 if not public.is_account_owner(a) then raise exception 'Правила гостей изменяет владелец';end if;
 if p_config is null or jsonb_typeof(p_config)<>'object' or not(p_config?&array['autoRead','intervalMinutes','birthdayToday','birthdayUpcoming','leadDays','groupTransitions','groupId','birthdayHour','birthdayMinute','groupHour','groupMinute']) or p_config-array['autoRead','intervalMinutes','birthdayToday','birthdayUpcoming','leadDays','groupTransitions','groupId','birthdayHour','birthdayMinute','groupHour','groupMinute']<>'{}' or p_reason is null or length(trim(p_reason))not between 1 and 1000 then raise exception 'Проверьте правила гостей и основание';end if;
 foreach k in array array['autoRead','birthdayToday','birthdayUpcoming','groupTransitions']loop if jsonb_typeof(p_config->k)is distinct from 'boolean'then raise exception 'Проверьте включение правил гостей';end if;end loop;
 foreach k in array array['intervalMinutes','leadDays','groupId','birthdayHour','birthdayMinute','groupHour','groupMinute']loop if jsonb_typeof(p_config->k)is distinct from 'number'or(p_config->>k)!~'^\d+$'then raise exception 'Проверьте параметры правил гостей';end if;end loop;
 if(p_config->>'intervalMinutes')::integer not between 15 and 1440 or(p_config->>'leadDays')::integer not between 1 and 60 or(p_config->>'groupId')::bigint<1 or(p_config->>'birthdayHour')::integer not between 0 and 23 or(p_config->>'groupHour')::integer not between 0 and 23 or(p_config->>'birthdayMinute')::integer not between 0 and 59 or(p_config->>'groupMinute')::integer not between 0 and 59 then raise exception 'Проверьте интервал, время и группу гостей';end if;
 if not(p_config->>'autoRead')::boolean and((p_config->>'birthdayToday')::boolean or(p_config->>'birthdayUpcoming')::boolean or(p_config->>'groupTransitions')::boolean)then raise exception 'Для уведомлений включите обновление источника';end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-guest-rules:'||p_venue,0));
 select * into old from private.crm_guest_rules where venue_id=p_venue order by version desc limit 1;
 if old.config=p_config and old.reason=trim(p_reason) and old.actor_id=auth.uid()then return old.id;end if;
 if p_version is distinct from coalesce(old.version,0)then raise exception 'Правила изменились. Обновите страницу';end if;
 select * into source from private.crm_guest_sources where venue_id=p_venue and account_id=a;
 if(p_config->>'groupTransitions')::boolean and not exists(select 1 from jsonb_array_elements(coalesce(source.groups,'[]'))g where g->>'id'=p_config->>'groupId')then raise exception 'Выберите группу из проверенного Quick Resto';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь')into actor from public.profiles where id=auth.uid();
 insert into private.crm_guest_rules(account_id,venue_id,version,config,reason,actor_id,actor_name)values(a,p_venue,coalesce(old.version,0)+1,p_config,trim(p_reason),auth.uid(),coalesce(actor,'Пользователь'))returning id into rid;
 -- Activating/changing a target establishes a baseline, never an archive blast.
 if(p_config->>'groupTransitions')::boolean and(not coalesce((old.config->>'groupTransitions')::boolean,false)or old.config->>'groupId'is distinct from p_config->>'groupId')then
  insert into private.crm_guest_seen_groups(account_id,venue_id,provider,group_id,qr_id,origin)
   select a,p_venue,source.provider,(p_config->>'groupId')::bigint,qr_id,'activation'from private.crm_guests where account_id=a and venue_id=p_venue and qr_id is not null and source_data->>'groupId'=p_config->>'groupId' and not coalesce((source_data->>'sourceMissing')::boolean,false)on conflict do nothing;
 end if;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)values(a,p_venue,auth.uid(),'crm.guest.rules_saved','venue',p_venue,jsonb_build_object('version',coalesce(old.version,0)+1,'reason',trim(p_reason)));
 return rid;
end $$;
revoke all on function public.crm_guest_save_rules(uuid,integer,jsonb,text) from public,anon,service_role;
grant execute on function public.crm_guest_save_rules(uuid,integer,jsonb,text) to authenticated;
create function public.crm_guest_schedule()returns integer language plpgsql security definer set search_path='' as $$
declare r record;last_read timestamptz;birthday_due timestamptz;group_due timestamptz;today date;n integer:=0;begin
 for r in select p.*,s.timezone from(select distinct on(venue_id)*from private.crm_guest_rules order by venue_id,version desc)p join public.sales_settings s on s.account_id=p.account_id and s.venue_id=p.venue_id join public.venues v on v.id=p.venue_id where v.archived_at is null and(p.config->>'autoRead')::boolean loop
  if exists(select 1 from private.crm_guest_jobs where venue_id=r.venue_id and state in('pending','running'))then continue;end if;
  select max(created_at)into last_read from private.crm_guest_jobs where venue_id=r.venue_id;
  if last_read>now()-interval '15 minutes' and exists(select 1 from private.crm_guest_jobs where venue_id=r.venue_id and state='error' and created_at=last_read)then continue;end if;
  today:=(now()at time zone r.timezone)::date;
  birthday_due:=(today+make_time((r.config->>'birthdayHour')::integer,(r.config->>'birthdayMinute')::integer,0))at time zone r.timezone;
  group_due:=(today+make_time((r.config->>'groupHour')::integer,(r.config->>'groupMinute')::integer,0))at time zone r.timezone;
  if last_read is null or last_read<=now()-make_interval(mins=>(r.config->>'intervalMinutes')::integer)or(now()>=birthday_due and last_read<birthday_due and((r.config->>'birthdayToday')::boolean or(r.config->>'birthdayUpcoming')::boolean))or(now()>=group_due and last_read<group_due and(r.config->>'groupTransitions')::boolean)then
   perform private.crm_guest_enqueue(r.account_id,r.venue_id,null);n:=n+1;
  end if;
 end loop;return n;
end $$;
revoke all on function public.crm_guest_schedule()from public,anon,authenticated;
grant execute on function public.crm_guest_schedule()to service_role;

create function private.crm_guest_recipient(v uuid,u uuid)returns boolean language sql stable security definer set search_path='' as $$
 select u is not null and exists(select 1 from public.venues ve join public.accounts a on a.id=ve.account_id join auth.users au on au.id=u where ve.id=v and ve.archived_at is null and(au.banned_until is null or au.banned_until<=now())and(a.owner_id=u or exists(select 1 from public.user_venue_roles m join public.roles r on r.id=m.role_id join public.role_permissions rp on rp.role_id=r.id and rp.granted join public.permissions p on p.id=rp.permission_id and p.code='crm.view_guests' where m.user_id=u and m.venue_id=v and m.status='active' and m.fired_at is null and(r.venue_id=v or r.venue_id is null))))
$$;
revoke all on function private.crm_guest_recipient(uuid,uuid)from public,anon,authenticated,service_role;
create function public.crm_guest_notification_visible(p_venue uuid)returns boolean language sql stable security definer set search_path='' as $$select private.crm_guest_recipient(p_venue,auth.uid())$$;
revoke all on function public.crm_guest_notification_visible(uuid)from public,anon;
grant execute on function public.crm_guest_notification_visible(uuid)to authenticated;
create policy crm_guest_notification_read on public.notifications as restrictive for select to authenticated using(type not like 'crm.guest.%'or public.crm_guest_notification_visible(venue_id));
create policy crm_guest_notification_update on public.notifications as restrictive for update to authenticated using(type not like 'crm.guest.%'or public.crm_guest_notification_visible(venue_id))with check(type not like 'crm.guest.%'or public.crm_guest_notification_visible(venue_id));
create unique index crm_guest_notification_once on public.notifications(user_id,entity_id,type)where entity_type='crm_guest_event'and type like 'crm.guest.%';
create function private.crm_emit_guest_event(a uuid,v uuid,g uuid,k text,key text,p_title text,p_body text,p_payload jsonb)returns boolean language plpgsql security definer set search_path='' as $$
declare event uuid;owner uuid;n integer;begin
 insert into private.crm_guest_events(account_id,venue_id,event_key,kind,guest_id,payload)values(a,v,key,k,g,p_payload)on conflict(venue_id,event_key)do nothing returning id into event;
 if event is null then return false;end if;
 select owner_id into owner from public.accounts where id=a;
 insert into public.notifications(user_id,venue_id,type,category,title,body,link,entity_type,entity_id,payload,pushed_at)
 select distinct u.id,v,'crm.guest.'||k,'crm',p_title,p_body,'/crm/guests?guest='||g,'crm_guest_event',event,p_payload,now()
 from(select owner id union select user_id from public.user_venue_roles where venue_id=v and status='active'and fired_at is null)c join auth.users u on u.id=c.id where private.crm_guest_recipient(v,u.id)
 on conflict(user_id,entity_id,type)where entity_type='crm_guest_event'and type like 'crm.guest.%'do nothing;
 get diagnostics n=row_count;
 insert into public.audit_logs(account_id,venue_id,action_code,entity_type,entity_id,details)values(a,v,'crm.guest.notification_sent','guest',g,jsonb_build_object('kind',k,'recipients',n,'eventId',event));return true;
end $$;
revoke all on function private.crm_emit_guest_event(uuid,uuid,uuid,text,text,text,text,jsonb)from public,anon,authenticated,service_role;
create function private.crm_guest_notice_since(v uuid,kind text,group_id text default null)returns timestamptz language sql stable set search_path='' as $$
 with boundary as(select coalesce(max(version),0)version from private.crm_guest_rules where venue_id=v and(not(config->>kind)::boolean or(group_id is not null and config->>'groupId'is distinct from group_id)))select min(created_at)from private.crm_guest_rules where venue_id=v and version>(select version from boundary)
$$;
revoke all on function private.crm_guest_notice_since(uuid,text,text)from public,anon,authenticated,service_role;
create function private.crm_guest_notify_due(a uuid,v uuid)returns integer language plpgsql security definer set search_path='' as $$
declare rule private.crm_guest_rules;source private.crm_guest_sources;g private.crm_guests;data jsonb;tz text;today date;target date;scheduled timestamptz;since timestamptz;k text;lead integer;key text;n integer:=0;begin
 select *into rule from private.crm_guest_rules where account_id=a and venue_id=v order by version desc limit 1;if not found then return 0;end if;
 select *into source from private.crm_guest_sources where account_id=a and venue_id=v;if not found or source.checked_at<now()-interval '48 hours'then return 0;end if;
 select timezone into tz from public.sales_settings where account_id=a and venue_id=v;today:=(now()at time zone tz)::date;
 foreach k in array array['birthdayToday','birthdayUpcoming']loop
  if not(rule.config->>k)::boolean then continue;end if;
  scheduled:=(today+make_time((rule.config->>'birthdayHour')::integer,(rule.config->>'birthdayMinute')::integer,0))at time zone tz;
  since:=private.crm_guest_notice_since(v,k);if scheduled>now()or since is null or scheduled<since then continue;end if;
  lead:=case when k='birthdayToday'then 0 else(rule.config->>'leadDays')::integer end;target:=today+lead;
  for g in select *from private.crm_guests where account_id=a and venue_id=v and archived_at is null and not coalesce((source_data->>'sourceMissing')::boolean,false)loop
   data:=g.source_data||g.local_data;
   if(data->>'day')::integer is distinct from extract(day from target)::integer or(data->>'month')::integer is distinct from extract(month from target)::integer then continue;end if;
   key:=case when k='birthdayToday'then 'birthday:'else 'birthday_upcoming:'end||source.provider||':'||g.id||':'||extract(year from target)::integer;
   if private.crm_emit_guest_event(a,v,g.id,case when k='birthdayToday'then 'birthday'else 'birthday_upcoming'end,key,case when k='birthdayToday'then 'День рождения гостя'else 'Скоро день рождения гостя'end,(data->>'name')||case when lead=0 then ' — сегодня.'else ' — '||to_char(target,'DD.MM')||' (через '||lead||' дн.).'end,jsonb_build_object('date',target,'guestId',g.id,'ruleVersion',rule.version))then n:=n+1;end if;
  end loop;
 end loop;
 if(rule.config->>'groupTransitions')::boolean then
  scheduled:=(today+make_time((rule.config->>'groupHour')::integer,(rule.config->>'groupMinute')::integer,0))at time zone tz;
  since:=private.crm_guest_notice_since(v,'groupTransitions',rule.config->>'groupId');
  if scheduled<=now()and since is not null and scheduled>=since then
   for g in select *from private.crm_guests where account_id=a and venue_id=v and archived_at is null and qr_id is not null and source_data->>'groupId'=rule.config->>'groupId' and not coalesce((source_data->>'sourceMissing')::boolean,false)loop
    insert into private.crm_guest_seen_groups(account_id,venue_id,provider,group_id,qr_id,origin)values(a,v,source.provider,(rule.config->>'groupId')::bigint,g.qr_id,'notification')on conflict do nothing;
    if not found then continue;end if;
    if private.crm_emit_guest_event(a,v,g.id,'group','group:'||source.provider||':'||(rule.config->>'groupId')||':'||g.qr_id,'Новый гость в группе '||coalesce(g.source_data->>'groupTitle',''),coalesce((g.source_data||g.local_data)->>'name','Гость'),jsonb_build_object('guestId',g.id,'groupId',(rule.config->>'groupId')::bigint,'ruleVersion',rule.version))then n:=n+1;end if;
   end loop;
  end if;
 end if;return n;
end $$;
revoke all on function private.crm_guest_notify_due(uuid,uuid)from public,anon,authenticated,service_role;
create or replace function public.crm_guest_import_legacy(p_venue uuid,p_provider text,p_actor uuid,p_rows jsonb,p_seen jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare a uuid;owner uuid;g private.crm_guests;r jsonb;patch jsonb;before_data jsonb;actor text;reason text;created_n integer:=0;linked_n integer:=0;skipped_n integer:=0;legacy_hash text;begin
 select v.account_id,ac.owner_id into a,owner from public.venues v join public.accounts ac on ac.id=v.account_id where v.id=p_venue and v.archived_at is null for share of v;
 if a is null or p_actor is distinct from owner or p_provider is distinct from private.finance_execution_provider(a,p_venue)or not exists(select 1 from private.crm_guest_sources where venue_id=p_venue and account_id=a and provider=p_provider)then raise exception 'Не подтверждены источник и владелец переноса гостей';end if;
 if jsonb_typeof(p_rows)is distinct from 'array'or jsonb_array_length(p_rows)>10000 or octet_length(p_rows::text)>20000000 or jsonb_typeof(p_seen)is distinct from 'array'or jsonb_array_length(p_seen)>100000 then raise exception 'Проверьте состав переноса гостей';end if;
 if(select count(*)<>count(distinct input_row->>'legacyId')from jsonb_array_elements(p_rows)input_row)or(select count(input_row->>'qrId')<>count(distinct input_row->>'qrId')from jsonb_array_elements(p_rows)input_row)then raise exception 'Повторные связи гостей в переносе';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Владелец')into actor from public.profiles where id=p_actor;
 perform pg_advisory_xact_lock(hashtextextended('crm-guest-publish:'||p_venue,0));
 for r in select value from jsonb_array_elements(p_rows)loop
  if jsonb_typeof(r)<>'object'or not(r?&array['legacyId','qrId','patch','legacyData','reason'])or r-array['legacyId','qrId','patch','legacyData','reason']<>'{}'or jsonb_typeof(r->'legacyId')is distinct from 'string'or length(r->>'legacyId')not between 1 and 200 or jsonb_typeof(r->'legacyData')is distinct from 'object'or jsonb_typeof(r->'reason')is distinct from 'string'or length(trim(r->>'reason'))not between 1 and 1000 or(r->'qrId'<>'null'and(jsonb_typeof(r->'qrId')<>'number'or(r->>'qrId')!~'^[1-9][0-9]{0,15}$'))then raise exception 'Проверьте строку переноса гостя';end if;
  patch:=r->'patch';perform private.crm_validate_guest_patch(patch,a,p_venue);
  if patch?|array['groupTitle','discountPercent']then raise exception 'Прежние условия не меняют действующий Quick Resto';end if;
  select *into g from private.crm_guests where account_id=a and venue_id=p_venue and legacy_id=r->>'legacyId'for update;
  legacy_hash:=md5((r->'legacyData')::text);
  if found then
   if g.qr_id is distinct from(r->>'qrId')::bigint or md5(g.legacy_data::text)<>legacy_hash then raise exception 'Прежний перенос гостя отличается. Нужна отдельная сверка';end if;
   skipped_n:=skipped_n+1;continue;
  end if;
  if r->>'qrId'is not null then
   select *into g from private.crm_guests where account_id=a and venue_id=p_venue and qr_id=(r->>'qrId')::bigint for update;
   if not found or g.legacy_id is not null then raise exception 'Не подтверждена однозначная связь гостя Quick Resto';end if;
   before_data:=g.source_data||g.local_data;
   update private.crm_guests set legacy_id=r->>'legacyId',legacy_data=r->'legacyData',local_data=patch||local_data,revision=revision+1,updated_at=now()where id=g.id returning *into g;linked_n:=linked_n+1;
  else
   if trim(coalesce(patch->>'name',''))=''then raise exception 'Не указано имя прежнего гостя';end if;
   before_data:=null;insert into private.crm_guests(account_id,venue_id,legacy_id,legacy_data,local_data,created_by)values(a,p_venue,r->>'legacyId',r->'legacyData',patch,p_actor)returning *into g;created_n:=created_n+1;
  end if;
  -- A legacy birthday must be valid as a whole, including partial-year rules.
  if((g.source_data||g.local_data)->>'day'is null)is distinct from((g.source_data||g.local_data)->>'month'is null)then raise exception 'Неполная дата рождения в прежней карточке';end if;
  if(g.source_data||g.local_data)->>'day'is not null then perform make_date(coalesce(((g.source_data||g.local_data)->>'year')::integer,2000),((g.source_data||g.local_data)->>'month')::integer,((g.source_data||g.local_data)->>'day')::integer);end if;
  insert into private.crm_guest_history(guest_id,account_id,venue_id,action,revision,before_data,after_data,actor_id,actor_name,reason)values(g.id,a,p_venue,'legacy_imported',g.revision,before_data,g.source_data||g.local_data,p_actor,coalesce(actor,'Владелец'),r->>'reason');
 end loop;
 for r in select value from jsonb_array_elements(p_seen)loop
  if jsonb_typeof(r)<>'object'or(r->>'guestId')!~'^[1-9][0-9]{0,15}$'or r-array['guestId','joinedAt']<>'{}'then raise exception 'Некорректная история Silver';end if;
  insert into private.crm_guest_seen_groups(account_id,venue_id,provider,group_id,qr_id,first_seen_at,origin)values(a,p_venue,p_provider,4,(r->>'guestId')::bigint,coalesce((r->>'joinedAt')::timestamptz,now()),'n8n')on conflict do nothing;
 end loop;
 if created_n+linked_n>0 then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)values(a,p_venue,p_actor,'crm.guest.legacy_imported','venue',p_venue,jsonb_build_object('created',created_n,'linked',linked_n,'source','Glide'));end if;
 return jsonb_build_object('created',created_n,'linked',linked_n,'skipped',skipped_n);
end $$;
revoke all on function public.crm_guest_import_legacy(uuid,text,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.crm_guest_import_legacy(uuid,text,uuid,jsonb,jsonb)to service_role;

alter table private.sales_worker_rotation drop constraint sales_worker_rotation_lane_check;
alter table private.sales_worker_rotation add constraint sales_worker_rotation_lane_check check(lane between 0 and 8);
create or replace function public.sales_next_worker_lane()returns integer language sql security definer set search_path=''as $$
 insert into private.sales_worker_rotation as rotation(id,lane)values(true,0)on conflict(id)do update set lane=(rotation.lane+1)%9 returning lane;
$$;
revoke all on function public.sales_next_worker_lane()from public,anon,authenticated;
grant execute on function public.sales_next_worker_lane()to service_role;
commit;
