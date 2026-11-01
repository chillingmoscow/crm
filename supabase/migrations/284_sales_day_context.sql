begin;
-- Source snapshots are read-only evidence. No ledger or payroll calculation writes.
create table public.sales_day_archive (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,legacy_ref text not null,
 metrics jsonb not null check(jsonb_typeof(metrics)='object'),origin jsonb not null check(jsonb_typeof(origin)='object'),
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),captured_at timestamptz not null,imported_at timestamptz not null default now(),imported_by uuid not null references public.profiles(id),
 unique(account_id,venue_id,id),unique(venue_id,business_date,captured_at),foreign key(account_id,venue_id) references public.venues(account_id,id)
);
create index sales_day_archive_scope on public.sales_day_archive(account_id,venue_id,business_date desc,captured_at desc,id);
create index sales_day_archive_author on public.sales_day_archive(imported_by);
create table public.payroll_day_archive_members (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,day_archive_id uuid not null,
 legacy_ref text not null,name text not null,position text not null,salary numeric,tips numeric,extras numeric,
 origin jsonb not null check(jsonb_typeof(origin)='object'),unique(day_archive_id,legacy_ref),
 foreign key(account_id,venue_id,day_archive_id) references public.sales_day_archive(account_id,venue_id,id)
);
create index payroll_day_archive_members_scope on public.payroll_day_archive_members(account_id,venue_id,day_archive_id,id);
create table public.sales_day_comments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,
 author_id uuid references public.profiles(id),author_name text not null,body text not null check(length(trim(body)) between 1 and 4000),
 origin text not null default 'native' check(origin in ('native','glide')),source_ref text,source_snapshot jsonb not null default '{}',
 request_key uuid,request_body text,version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,deleted_by uuid references public.profiles(id),
 unique(account_id,venue_id,id),unique(author_id,request_key),unique(venue_id,source_ref),foreign key(account_id,venue_id) references public.venues(account_id,id),
 check(origin<>'native' or (author_id is not null and request_key is not null and request_body is not null))
);
create index sales_day_comments_scope on public.sales_day_comments(account_id,venue_id,business_date,created_at,id);
create index sales_day_comments_author on public.sales_day_comments(author_id);
create index sales_day_comments_deleted_by on public.sales_day_comments(deleted_by);
create table public.sales_day_comment_history (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,comment_id uuid not null,
 actor_id uuid references public.profiles(id),actor_name text not null,action text not null check(action in ('created','updated','deleted','restored','imported','source_updated')),
 details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,comment_id) references public.sales_day_comments(account_id,venue_id,id)
);
create index sales_day_comment_history_scope on public.sales_day_comment_history(account_id,venue_id,comment_id,created_at,id);
create index sales_day_comment_history_actor on public.sales_day_comment_history(actor_id);

do $$ declare t text;begin
 foreach t in array array['sales_day_archive','payroll_day_archive_members','sales_day_comments','sales_day_comment_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy sales_day_read on public.%I for select to authenticated using(account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission(''sales.view_shifts'')) %s)',t,case when t='payroll_day_archive_members' then 'and (select public.has_permission(''payroll.view''))' else '' end);
 end loop;
end $$;
grant select,insert on public.sales_day_archive,public.payroll_day_archive_members,public.sales_day_comment_history to service_role;
grant select,insert,update on public.sales_day_comments to service_role;
-- Comment text in the event log must obey the same audience as the discussion.
create policy sales_day_comment_audit_read on public.audit_logs as restrictive for select to authenticated using(
 action_code not like 'sales.comment.%' or (account_id=(select public.get_active_account_id()) and venue_id=(select public.get_active_venue_id()) and (select public.has_permission('sales.view_shifts')))
);

create function private.sales_comment_event(c public.sales_day_comments,p_action text,p_details jsonb,p_actor uuid,p_name text) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 insert into public.sales_day_comment_history(account_id,venue_id,comment_id,actor_id,actor_name,action,details) values(c.account_id,c.venue_id,c.id,p_actor,p_name,p_action,p_details);
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(c.account_id,c.venue_id,p_actor,'sales.comment.'||p_action,'sales_day_comment',c.id,p_details||jsonb_build_object('business_date',c.business_date,'comment_id',c.id));
end $$;
revoke all on function private.sales_comment_event(public.sales_day_comments,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function private.sales_comment_event(public.sales_day_comments,text,jsonb,uuid,text) to service_role;

create function public.sales_day_comment_command(p_expected_venue uuid,p_action text,p_input jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();u uuid:=auth.uid();c public.sales_day_comments;x uuid;d date;b text;k uuid;actor text;prev jsonb;event_action text;
begin
 if u is null or a is null or v is null or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к обсуждению смены';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Проверьте комментарий';end if;
 select trim(concat_ws(' ',first_name,last_name)) into actor from public.profiles where id=u;actor:=coalesce(nullif(actor,''),'Пользователь');
 if p_action='create' then
  d:=(p_input->>'date')::date;b:=trim(p_input->>'body');k:=(p_input->>'request_key')::uuid;
  if d is null or extract(year from d) not between 2000 and 2100 or b is null or length(b) not between 1 and 4000 or k is null then raise exception 'Введите комментарий до 4000 символов';end if;
  if not exists(select 1 from public.sales_days where account_id=a and venue_id=v and business_date=d) and not exists(select 1 from public.sales_day_archive where account_id=a and venue_id=v and business_date=d) then raise exception 'Смена ещё не загружена';end if;
  insert into public.sales_day_comments(account_id,venue_id,business_date,author_id,author_name,body,request_key,request_body) values(a,v,d,u,actor,b,k,b) on conflict(author_id,request_key) do nothing returning id into x;
  if x is null then
   select * into c from public.sales_day_comments where author_id=u and request_key=k;
   if c.account_id is distinct from a or c.venue_id is distinct from v or c.business_date is distinct from d or c.request_body is distinct from b then raise exception 'Этот запрос уже использован для другого комментария';end if;return c.id;
  end if;
  select * into c from public.sales_day_comments where id=x;
  perform private.sales_comment_event(c,'created',jsonb_build_object('body',b),u,actor);
  -- Only native creation notifies; imports/edits/restores do not replay old alerts.
  insert into public.notifications(user_id,venue_id,type,category,title,body,link,actor_user_id,entity_type,entity_id,payload)
  select distinct m.user_id,v,'sales.day_comment','system',actor||': комментарий к смене','Смена '||to_char(d,'DD.MM.YYYY'),'/sales/shifts?from='||d||'&to='||d||'&day='||d||'&tab=comments',u,'sales_day_comment',c.id,jsonb_build_object('business_date',d,'comment_id',c.id,'preview_kind','generic')
  from public.user_venue_roles m join public.role_permissions rp on rp.role_id=m.role_id and rp.granted join public.permissions p on p.id=rp.permission_id and p.code='sales.view_shifts'
  where m.venue_id=v and m.status='active' and m.fired_at is null and m.user_id<>u and exists(select 1 from auth.users auth_user where auth_user.id=m.user_id);
  return c.id;
 end if;
 select * into c from public.sales_day_comments where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
 if not found then raise exception 'Комментарий недоступен';end if;
 if c.business_date is distinct from (p_input->>'date')::date then raise exception 'Дата смены изменилась. Обновите обсуждение';end if;
 if p_action='edit' then
  if c.origin<>'native' or c.author_id<>u then raise exception 'Можно изменять только свой комментарий';end if;
  if c.deleted_at is not null then raise exception 'Комментарий удалён';end if;
  b:=trim(p_input->>'body');if b is null or length(b) not between 1 and 4000 then raise exception 'Введите комментарий до 4000 символов';end if;
  if b=c.body then return c.id;end if;
 elsif p_action in ('delete','restore') then
  if c.author_id is distinct from u and not public.has_permission('sales.configure_shifts') then raise exception 'Нет доступа к изменению этого комментария';end if;
  if (p_action='delete' and c.deleted_at is not null) or (p_action='restore' and c.deleted_at is null) then return c.id;end if;
 else raise exception 'Неизвестное действие с комментарием';end if;
 if (p_input->>'version')::integer is distinct from c.version then raise exception 'Комментарий изменился. Обновите обсуждение';end if;
 prev:=jsonb_build_object('body',c.body,'deleted_at',c.deleted_at);
 if p_action='edit' then
  update public.sales_day_comments set body=b,updated_at=now(),version=version+1 where id=c.id returning * into c;event_action:='updated';
 elsif p_action='delete' then
  update public.sales_day_comments set deleted_at=now(),deleted_by=u,updated_at=now(),version=version+1 where id=c.id returning * into c;event_action:='deleted';
 else
  update public.sales_day_comments set deleted_at=null,deleted_by=null,updated_at=now(),version=version+1 where id=c.id returning * into c;event_action:='restored';
 end if;
 perform private.sales_comment_event(c,event_action,jsonb_build_object('before',prev,'after',jsonb_build_object('body',c.body,'deleted_at',c.deleted_at)),u,actor);return c.id;
end $$;
revoke all on function public.sales_day_comment_command(uuid,text,jsonb) from public,anon;
grant execute on function public.sales_day_comment_command(uuid,text,jsonb) to authenticated;
commit;
