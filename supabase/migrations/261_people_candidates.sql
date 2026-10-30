-- Account-wide recruitment. Apply to self-hosted Supabase with psql ON_ERROR_STOP.
create table public.candidates (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
 full_name text not null check(length(trim(full_name)) between 1 and 300), phone text,
 phone_normalized text generated always as (regexp_replace(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'^8([0-9]{10})$','7\1')) stored,
 desired_position text, age integer check(age between 14 and 100), address text,
 social jsonb not null default '{}', education text, experience text, plans text, family_status text, drivers_license text, salary_expectation text,
 status text not null default 'new' check(status in ('new','review','interview','trial','rejected','hired')),
 status_order integer generated always as (case status when 'new' then 0 when 'review' then 1 when 'interview' then 2 when 'trial' then 3 when 'rejected' then 4 else 5 end) stored,
 responsible_id uuid references public.profiles(id) on delete set null,
 source text not null default 'manual' check(source in ('manual','tilda','notion')), source_id text, source_url text,
 submitted_at timestamptz not null default now(), legacy_data jsonb not null default '{}',
 hired_user_id uuid references public.profiles(id), hired_venue_id uuid, hired_role_id uuid references public.roles(id),
 hired_at timestamptz, hired_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision integer not null default 1,
 archived_at timestamptz, archived_by uuid references public.profiles(id),
 unique(account_id,id), foreign key(account_id,hired_venue_id) references public.venues(account_id,id),
 check((status='hired') = (hired_user_id is not null)), check((hired_user_id is null) = (hired_venue_id is null))
);
create unique index candidates_source_unique on public.candidates(account_id,source,source_id);
create index candidates_list on public.candidates(account_id,submitted_at desc,id desc) where archived_at is null;
create index candidates_status_list on public.candidates(account_id,status_order,submitted_at desc,id desc) where archived_at is null and status<>'hired';
create index candidates_phone on public.candidates(account_id,phone_normalized) where phone_normalized<>'';
create index candidates_hired_venue on public.candidates(account_id,hired_venue_id);
create table public.candidate_comments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,candidate_id uuid not null,
 author_id uuid references public.profiles(id) on delete set null,source_author text,source_id text,
 body text not null check(length(trim(body)) between 1 and 12000), created_at timestamptz not null default now(),
 foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade,
 unique(account_id,candidate_id,source_id)
);
create index candidate_comments_parent on public.candidate_comments(account_id,candidate_id,created_at);
create table public.candidate_appointments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,candidate_id uuid not null,
 kind text not null check(kind in ('interview','trial')), appointment_date date not null, starts_at timestamptz,
 timezone text not null default 'Europe/Moscow',location text,interviewer_id uuid references public.profiles(id) on delete set null,
 outcome text not null default 'scheduled' check(outcome in ('scheduled','passed','no_show','rejected','canceled')),
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),revision integer not null default 1,
 foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade
);
create index candidate_appointments_parent on public.candidate_appointments(account_id,candidate_id,appointment_date);
create table public.candidate_files (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,candidate_id uuid not null,
 name text not null,original_url text,storage_path text,mime_type text,size_bytes bigint,
 state text not null default 'pending' check(state in ('pending','ready','missing','error','external')), error text,attempts integer not null default 0,
 created_at timestamptz not null default now(),unique(storage_path),unique(account_id,candidate_id,original_url),
 foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade
);
create index candidate_files_parent on public.candidate_files(account_id,candidate_id);
create table public.candidate_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,candidate_id uuid not null,
 actor_id uuid references public.profiles(id) on delete set null,kind text not null,details jsonb not null default '{}',
 created_at timestamptz not null default now(), foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade
);
create index candidate_events_parent on public.candidate_events(account_id,candidate_id,created_at desc,id desc);
create table public.candidate_connections (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 secret_hash text not null,enabled boolean not null default false,form_id text not null,
 telegram_chat_id text,telegram_secret jsonb,last_received_at timestamptz,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),unique(account_id),unique(account_id,id)
);
create table public.candidate_deliveries (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,connection_id uuid not null,source_id text not null,
 payload jsonb not null,candidate_id uuid not null,created_at timestamptz not null default now(),
 unique(connection_id,source_id),foreign key(account_id,connection_id) references public.candidate_connections(account_id,id) on delete cascade,
 foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade
);
create index candidate_deliveries_candidate on public.candidate_deliveries(account_id,candidate_id);
create index candidate_deliveries_connection on public.candidate_deliveries(account_id,connection_id);
create table public.candidate_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 candidate_id uuid,kind text not null check(kind in ('notify','file_cleanup')),payload jsonb not null default '{}',
 state text not null default 'pending' check(state in ('pending','working','done','error')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,error text,
 created_at timestamptz not null default now(),unique(candidate_id,kind)
);
create index candidate_jobs_pending on public.candidate_jobs(available_at) where state in ('pending','working','error');
create table public.candidate_hires (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,candidate_id uuid not null,
 target_user_id uuid not null,existing_user boolean not null,actor_id uuid not null references public.profiles(id),
 input jsonb not null,state text not null default 'reserved' check(state in ('reserved','complete')),
 created_at timestamptz not null default now(),unique(account_id,candidate_id),
 foreign key(account_id,candidate_id) references public.candidates(account_id,id) on delete cascade
);
create index candidate_hires_parent on public.candidate_hires(account_id,candidate_id);

insert into public.permissions(id,code,module,description) values
 (gen_random_uuid(),'people.manage_candidates','people','Доступ к кандидатам: просмотр и ведение анкет, комментариев и встреч') on conflict(code) do nothing;
insert into public.role_permissions(role_id,permission_id,granted)
select r.id,p.id,true from public.roles r cross join public.permissions p
where r.code in ('owner','custom_manager','custom_admin') and p.code in ('people.manage_candidates') on conflict do nothing;
create function public.candidate_seed_role_permissions() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if new.code in ('owner','custom_manager','custom_admin') then
 insert into public.role_permissions(role_id,permission_id,granted) select new.id,id,true from public.permissions where code in ('people.manage_candidates') on conflict do nothing;
 end if; return new;
end $$;
create trigger candidate_seed_role_permissions after insert on public.roles for each row execute function public.candidate_seed_role_permissions();
create function private.candidate_access(a uuid,writing boolean default false) returns boolean language sql stable security definer set search_path=public,pg_catalog as $$
 select (select auth.uid()) is not null and a=public.get_active_account_id() and
 public.has_permission('people.manage_candidates')
$$;
create function private.candidate_venue_permission(u uuid,v uuid,p text) returns boolean language sql stable security definer set search_path=public,pg_catalog as $$
 select exists(select 1 from public.venues venue join public.accounts a on a.id=venue.account_id where venue.id=v and venue.archived_at is null and (a.owner_id=u or exists(
 select 1 from public.user_venue_roles m join public.role_permissions rp on rp.role_id=m.role_id join public.permissions perm on perm.id=rp.permission_id
 where m.user_id=u and m.venue_id=v and m.status='active' and m.fired_at is null and rp.granted and perm.code=p)))
$$;
revoke all on function private.candidate_venue_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.candidate_access(uuid,boolean) to authenticated;

do $$ declare t text;begin
 foreach t in array array['candidates','candidate_comments','candidate_appointments','candidate_files','candidate_events','candidate_connections','candidate_deliveries','candidate_jobs','candidate_hires'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
 foreach t in array array['candidates','candidate_comments','candidate_appointments','candidate_files','candidate_events'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy candidate_read on public.%I for select to authenticated using (private.candidate_access(account_id,false))',t);
 end loop;
end $$;
-- Column grants keep employment links and imported identity server-controlled.
grant update(full_name,phone,desired_position,age,address,social,education,experience,plans,family_status,drivers_license,salary_expectation,status) on public.candidates to authenticated;
create policy candidate_update on public.candidates for update to authenticated using(private.candidate_access(account_id,true) and archived_at is null) with check(private.candidate_access(account_id,true) and status<>'hired' and hired_user_id is null);
-- Managers never receive the integration credentials or the Auth provisioning journal.
revoke all on function private.candidate_access(uuid,boolean) from public,anon;
grant usage on schema private to authenticated;

create function public.candidate_track_changes() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare changes jsonb:='{}';k text;event_kind text;
begin
 if TG_OP='DELETE' then
 if not exists(select 1 from public.accounts where id=old.account_id) then return old;end if;
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(old.account_id,auth.uid(),'candidate.deleted','candidate',old.id,jsonb_build_object('name',old.full_name));return old;
 end if;
 if TG_OP='INSERT' then event_kind:='created';
 else
 new.updated_at:=now();new.revision:=old.revision+1;
 foreach k in array array['full_name','phone','desired_position','age','address','social','education','experience','plans','family_status','drivers_license','salary_expectation','status','responsible_id','hired_user_id','hired_venue_id','hired_role_id','archived_at'] loop
 if to_jsonb(old)->k is distinct from to_jsonb(new)->k then changes:=changes||jsonb_build_object(k,jsonb_build_object('old',to_jsonb(old)->k,'new',to_jsonb(new)->k));end if;
 end loop;
 if changes='{}' then return new;end if;
 event_kind:=case when old.archived_at is null and new.archived_at is not null then 'archived' when old.archived_at is not null and new.archived_at is null then 'restored' when old.hired_user_id is null and new.hired_user_id is not null then 'hired' else 'updated' end;
 end if;
 -- BEFORE INSERT cannot reference its parent yet; creation is handled by AFTER trigger below.
 if TG_OP='UPDATE' then
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(new.account_id,new.id,auth.uid(),event_kind,jsonb_build_object('changes',changes));
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(new.account_id,auth.uid(),'candidate.'||event_kind,'candidate',new.id,jsonb_build_object('name',new.full_name,'changes',changes));
 end if;return new;
end $$;
create trigger candidate_changes before update or delete on public.candidates for each row execute function public.candidate_track_changes();
create function public.candidate_created_event() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(new.account_id,new.id,auth.uid(),'created',jsonb_build_object('source',new.source));return new;
end $$;
create trigger candidate_created after insert on public.candidates for each row execute function public.candidate_created_event();

create function public.candidate_command(p_action text,p_id uuid default null,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;ident uuid;r public.candidate_appointments;owner boolean;
begin
 if u is null or a is null then raise exception 'Войдите в аккаунт';end if;
 if p_action not in ('update','comment','appointment','archive','restore','delete') then raise exception 'Неизвестное действие';end if;
 if not private.candidate_access(a,true) then raise exception 'Нет права вести кандидатов';end if;
 select * into c from public.candidates where id=p_id and account_id=a for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 if p_action in ('archive','restore','delete') then
 if exists(select 1 from public.candidate_hires where candidate_id=c.id and lease_until>now()) then raise exception 'Дождитесь завершения оформления сотрудника';end if;
 select owner_id=u into owner from public.accounts where id=a;
 if not coalesce(owner,false) then raise exception 'Доступно только владельцу аккаунта';end if;
 if p_action='delete' then
 if c.hired_user_id is not null or exists(select 1 from public.candidate_hires where candidate_id=c.id) then raise exception 'Анкета связана с оформлением сотрудника. Её можно архивировать';end if;
 insert into public.candidate_jobs(account_id,kind,payload) select a,'file_cleanup',jsonb_build_object('paths',jsonb_agg(storage_path)) from public.candidate_files where account_id=a and candidate_id=c.id and storage_path is not null having count(*)>0;
 delete from public.candidates where id=c.id;return '{}';
 end if;
 update public.candidates set archived_at=case when p_action='archive' then now() else null end,archived_by=case when p_action='archive' then u else null end where id=c.id;return '{}';
 end if;
 if c.archived_at is not null then raise exception 'Сначала восстановите анкету из архива';end if;
 if p_action='update' then
 if p_input?'responsible_id' then raise exception 'Назначение ответственного больше не используется';end if;
 if c.revision is distinct from (p_input->>'revision')::int then raise exception 'Анкета изменена. Обновите страницу';end if;
 if p_input ? 'status' and (p_input->>'status'='hired' or c.status='hired' and p_input->>'status'<>'hired') then raise exception 'Приём на работу доступен через кнопку «Принять на работу»';end if;
 update public.candidates set
 full_name=case when p_input?'full_name' then trim(p_input->>'full_name') else full_name end,
 phone=case when p_input?'phone' then p_input->>'phone' else phone end,
 desired_position=case when p_input?'desired_position' then p_input->>'desired_position' else desired_position end,
 age=case when p_input?'age' then nullif(p_input->>'age','')::int else age end,
 address=case when p_input?'address' then p_input->>'address' else address end,
 social=case when p_input?'social' then p_input->'social' else social end,
 education=case when p_input?'education' then p_input->>'education' else education end,
 experience=case when p_input?'experience' then p_input->>'experience' else experience end,
 plans=case when p_input?'plans' then p_input->>'plans' else plans end,
 family_status=case when p_input?'family_status' then p_input->>'family_status' else family_status end,
 drivers_license=case when p_input?'drivers_license' then p_input->>'drivers_license' else drivers_license end,
 salary_expectation=case when p_input?'salary_expectation' then p_input->>'salary_expectation' else salary_expectation end,
 status=coalesce(p_input->>'status',status) where id=c.id returning * into c;
 elsif p_action='comment' then
 insert into public.candidate_comments(account_id,candidate_id,author_id,body,source_id) values(a,c.id,u,trim(p_input->>'body'),p_input->>'request_key') on conflict(account_id,candidate_id,source_id) do nothing returning id into ident;
 if ident is not null then insert into public.candidate_events(account_id,candidate_id,actor_id,kind) values(a,c.id,u,'commented');end if;
 elsif p_action='appointment' then
 ident:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid());
 select * into r from public.candidate_appointments where id=ident and account_id=a and candidate_id=c.id for update;
 if found and r.revision is distinct from (p_input->>'revision')::int then raise exception 'Встреча изменена. Обновите страницу';end if;
 if p_input->>'timezone' not in (select name from pg_timezone_names) then raise exception 'Неизвестный часовой пояс';end if;
 if nullif(p_input->>'interviewer_id','') is not null and not exists(select 1 from public.user_venue_roles m join public.venues v on v.id=m.venue_id where m.user_id=(p_input->>'interviewer_id')::uuid and v.account_id=a and m.status='active' and m.fired_at is null) then raise exception 'Интервьюер недоступен';end if;
 insert into public.candidate_appointments(id,account_id,candidate_id,kind,appointment_date,starts_at,timezone,location,interviewer_id,outcome,notes)
 values(ident,a,c.id,p_input->>'kind',(p_input->>'appointment_date')::date,nullif(p_input->>'starts_at','')::timestamptz,p_input->>'timezone',p_input->>'location',nullif(p_input->>'interviewer_id','')::uuid,coalesce(p_input->>'outcome','scheduled'),p_input->>'notes')
 on conflict(id) do update set kind=excluded.kind,appointment_date=excluded.appointment_date,starts_at=excluded.starts_at,timezone=excluded.timezone,location=excluded.location,interviewer_id=excluded.interviewer_id,outcome=excluded.outcome,notes=excluded.notes,updated_at=now(),revision=public.candidate_appointments.revision+1
 where public.candidate_appointments.account_id=a and public.candidate_appointments.candidate_id=c.id;
 if not found then raise exception 'Встреча недоступна';end if;
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(a,c.id,u,case when r.id is null then 'appointment_created' else 'appointment_updated' end,jsonb_build_object('before',to_jsonb(r),'after',(select to_jsonb(saved) from public.candidate_appointments saved where saved.id=ident)));
 end if;return jsonb_build_object('id',coalesce(ident,c.id),'revision',c.revision,'status',c.status);
end $$;
revoke all on function public.candidate_command(text,uuid,jsonb) from public,anon;
grant execute on function public.candidate_command(text,uuid,jsonb) to authenticated;

alter table public.candidate_hires add column provisioning jsonb not null default '{}';
alter table public.candidate_hires add column error text;
alter table public.candidate_hires add column lease_until timestamptz;
create table public.candidate_employment_settings (
 account_id uuid not null,venue_id uuid primary key,store_ids bigint[] not null default '{1}',master_store_ids bigint[] not null default '{16}',
 staff_group_id bigint not null default 8,bonus_account_type_id bigint not null default 1,office_pool_initialized boolean not null default false,
 unique(account_id,venue_id),foreign key(account_id,venue_id) references public.venues(account_id,id) on delete cascade
);
create table public.staff_door_codes (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id) on delete cascade,
 user_id uuid references public.profiles(id),hire_id uuid references public.candidate_hires(id),user_number integer not null check(user_number between 100 and 999),
 password_hash text not null,password_secret jsonb,source text not null check(source in ('legacy','sheerly')),
 unique(account_id,user_number),unique(account_id,password_hash),unique(hire_id)
);
alter table public.candidate_employment_settings enable row level security;
alter table public.staff_door_codes enable row level security;
revoke all on public.candidate_employment_settings,public.staff_door_codes from public,anon,authenticated;

-- Durable ingress: one transaction stores the event, candidate, files and notification job.
create function public.candidate_receive(p_connection uuid,p_source_id text,p_input jsonb,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare conn public.candidate_connections;existing uuid;ident uuid;file_url text;
begin
 select * into conn from public.candidate_connections where id=p_connection and enabled for update;
 if not found then raise exception 'Приём заявок отключён';end if;
 select candidate_id into existing from public.candidate_deliveries where connection_id=conn.id and source_id=p_source_id;
 if existing is not null then return jsonb_build_object('id',existing,'created',false);end if;
 if length(p_source_id) not between 1 and 200 then raise exception 'Не указан номер заявки';end if;
 insert into public.candidates(account_id,full_name,phone,desired_position,age,address,social,education,experience,plans,family_status,drivers_license,salary_expectation,source,source_id)
 values(conn.account_id,p_input->>'full_name',p_input->>'phone',p_input->>'desired_position',nullif(p_input->>'age','')::int,p_input->>'address',coalesce(p_input->'social','{}'),p_input->>'education',p_input->>'experience',p_input->>'plans',p_input->>'family_status',p_input->>'drivers_license',p_input->>'salary_expectation','tilda',p_source_id) returning id into ident;
 insert into public.candidate_deliveries(account_id,connection_id,source_id,payload,candidate_id) values(conn.account_id,conn.id,p_source_id,p_payload,ident);
 for file_url in select jsonb_array_elements_text(coalesce(p_input->'photos','[]')) loop
 insert into public.candidate_files(account_id,candidate_id,name,original_url) values(conn.account_id,ident,'Фотография',file_url) on conflict do nothing;
 end loop;
 insert into public.candidate_jobs(account_id,candidate_id,kind) values(conn.account_id,ident,'notify');
 update public.candidate_connections set last_received_at=now() where id=conn.id;
 return jsonb_build_object('id',ident,'created',true);
end $$;
revoke all on function public.candidate_receive(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.candidate_receive(uuid,text,jsonb,jsonb) to service_role;

create function public.candidate_begin_hire(p_candidate uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;h public.candidate_hires;v uuid:=(p_input->>'venue_id')::uuid;r uuid:=(p_input->>'role_id')::uuid;existing uuid:=nullif(p_input->>'existing_user_id','')::uuid;m uuid; ident uuid;
begin
 if u is null or a is null or not public.has_permission('people.manage_candidates') then raise exception 'Нет права принимать кандидатов';end if;
 if not private.candidate_venue_permission(u,v,'people.invite_staff') or not private.candidate_venue_permission(u,v,'people.manage_candidates') or not exists(select 1 from public.venues where id=v and account_id=a and archived_at is null) then raise exception 'Нет прав на найм в выбранном заведении';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a and archived_at is null for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 select * into h from public.candidate_hires where account_id=a and candidate_id=c.id;
 if found then
 if h.state<>'complete' and h.input is distinct from p_input then raise exception 'Предыдущий приём ещё не завершён. Повторите с теми же данными';end if;
 return to_jsonb(h);
 end if;
 if c.status='hired' then raise exception 'Кандидат уже принят';end if;
 if c.revision is distinct from (p_input->>'revision')::int then raise exception 'Анкета изменена. Обновите страницу';end if;
 if length(trim(p_input->>'first_name'))<1 or length(trim(p_input->>'last_name'))<1 or nullif(p_input->>'employment_date','') is null then raise exception 'Укажите имя, фамилию и дату приёма';end if;
 if p_input->>'attendance_source' not in ('schedule','quickresto') then raise exception 'Выберите источник учёта смен';end if;
 select id into m from public.payroll_models where account_id=a and venue_id=v and role_id=r and is_role_default and not archived;
 if m is null or not exists(select 1 from public.roles where id=r and venue_id=v and archived_at is null) or not exists(select 1 from public.payroll_rule_versions where model_id=m and employee_id is null and valid_from<=(p_input->>'employment_date')::date) then raise exception 'Сначала настройте оплату должности на дату приёма';end if;
 if existing is not null then raise exception 'Используйте связь с существующим сотрудником';end if;
 if existing is not null and not exists(select 1 from public.user_venue_roles uv join public.venues ve on ve.id=uv.venue_id where uv.user_id=existing and ve.account_id=a) then raise exception 'Сотрудник недоступен';end if;
 insert into public.candidate_hires(account_id,candidate_id,target_user_id,existing_user,actor_id,input) values(a,c.id,coalesce(existing,gen_random_uuid()),existing is not null,u,p_input) returning * into h;
 return to_jsonb(h);
end $$;
revoke all on function public.candidate_begin_hire(uuid,jsonb) from public,anon;
grant execute on function public.candidate_begin_hire(uuid,jsonb) to authenticated;
create function public.candidate_finish_hire(p_hire uuid) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare h public.candidate_hires;c public.candidates;v uuid;r uuid;d date;m uuid;emp uuid;membership public.user_venue_roles;label text;
begin
 select * into h from public.candidate_hires where id=p_hire for update;
 if not found then raise exception 'Операция найма не найдена';end if;
 if h.state='complete' then return h.target_user_id;end if;
 v:=(h.input->>'venue_id')::uuid;r:=(h.input->>'role_id')::uuid;d:=(h.input->>'employment_date')::date;
 select * into c from public.candidates where id=h.candidate_id and account_id=h.account_id for update;
 if h.provisioning#>>'{employee,state}' is distinct from 'done' or h.provisioning#>>'{guest,state}' is distinct from 'done' or h.provisioning#>>'{bonus,state}' is distinct from 'done' or not exists(select 1 from public.staff_door_codes where hire_id=h.id) then raise exception 'Завершите создание в Quick Resto и выдачу кода замка';end if;
 if c.archived_at is not null or c.hired_user_id is not null then raise exception 'Состояние анкеты изменилось';end if;
 if not private.candidate_venue_permission(h.actor_id,v,'people.invite_staff') or not private.candidate_venue_permission(h.actor_id,v,'people.manage_candidates') then raise exception 'Права на найм изменились';end if;
 select pm.id,ro.name into m,label from public.payroll_models pm join public.roles ro on ro.id=pm.role_id where pm.account_id=h.account_id and pm.venue_id=v and pm.role_id=r and pm.is_role_default and not pm.archived and ro.archived_at is null;
 if m is null or not exists(select 1 from public.payroll_rule_versions where model_id=m and employee_id is null and valid_from<=d) then raise exception 'Условия оплаты изменились';end if;
 if not exists(select 1 from auth.users where id=h.target_user_id) then raise exception 'Учётная запись ещё не создана';end if;
 if not h.existing_user then
 update public.profiles set first_name=trim(h.input->>'first_name'),last_name=trim(h.input->>'last_name'),phone=c.phone,address=c.address where id=h.target_user_id;
 end if;
 select * into membership from public.user_venue_roles where user_id=h.target_user_id and venue_id=v for update;
 if found and (membership.status<>'active' or membership.fired_at is not null or membership.role_id<>r) then raise exception 'У сотрудника уже есть история работы в заведении. Используйте его карточку';end if;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status,invited_by) values(h.target_user_id,v,r,'active',h.actor_id) on conflict(user_id,venue_id) do nothing;
 insert into public.staff_account_details(account_id,user_id,employment_date) values(h.account_id,h.target_user_id,d) on conflict(account_id,user_id) do nothing;
 insert into public.payroll_employees(account_id,venue_id,name,local_user_id,role_name,role_id,model_id,hired_on,opening_confirmed)
 values(h.account_id,v,trim(h.input->>'first_name')||' '||trim(h.input->>'last_name'),h.target_user_id,label,r,m,d,true)
 on conflict(venue_id,local_user_id) where local_user_id is not null do nothing returning id into emp;
 if emp is not null then
 update public.payroll_employees set quickresto_id=(h.provisioning#>>'{employee,id}')::bigint,quickresto_guest_id=(h.provisioning#>>'{guest,id}')::bigint,quickresto_bonus_account_id=(h.provisioning#>>'{bonus,id}')::bigint where id=emp;
 insert into public.payroll_employee_models(account_id,venue_id,employee_id,model_id,valid_from,created_by) values(h.account_id,v,emp,m,d,h.actor_id);
 insert into public.payroll_attendance_rules(account_id,venue_id,employee_id,source,valid_from,reason,created_by) values(h.account_id,v,emp,h.input->>'attendance_source',d,'Приём из кандидатов',h.actor_id);
 end if;
 insert into public.schedule_qualifications(venue_id,user_id,role_id) values(v,h.target_user_id,r) on conflict do nothing;
 update public.candidates set status='hired',hired_user_id=h.target_user_id,hired_venue_id=v,hired_role_id=r,hired_at=now(),hired_by=h.actor_id where id=c.id;
 update public.candidate_events set actor_id=h.actor_id where candidate_id=c.id and kind='hired' and actor_id is null;
 update public.staff_door_codes set user_id=h.target_user_id where hire_id=h.id;
 update public.user_venue_roles set terminal_pin=h.provisioning#>>'{employee,pin}' where user_id=h.target_user_id and venue_id=v and h.provisioning#>>'{employee,pin}' is not null;
 if exists(select 1 from public.external_entity_links where account_id=h.account_id and provider='quickresto' and entity_type='staff' and external_id=h.provisioning#>>'{employee,id}' and local_id<>h.target_user_id) then raise exception 'Сотрудник Quick Resto уже связан с другой карточкой';end if;
 insert into public.external_entity_links(account_id,provider,entity_type,external_id,local_table,local_id) values(h.account_id,'quickresto','staff',h.provisioning#>>'{employee,id}','profiles',h.target_user_id) on conflict do nothing;
 update public.candidate_hires set state='complete',lease_until=null,error=null where id=h.id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(h.account_id,v,h.actor_id,'candidate.hired','staff',h.target_user_id,jsonb_build_object('candidate_id',c.id,'name',c.full_name,'role_name',label,'employment_date',d));
 return h.target_user_id;
end $$;
revoke all on function public.candidate_finish_hire(uuid) from public,anon,authenticated;
grant execute on function public.candidate_finish_hire(uuid) to service_role;

-- Leases survive a server restart; retries never create a new candidate.
create function public.candidate_claim_job() returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.candidate_jobs;begin
 select * into j from public.candidate_jobs where ((state in ('pending','error') and available_at<=now()) or (state='working' and lease_until<now())) and attempts<10 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.candidate_jobs set state='working',attempts=attempts+1,lease_until=now()+interval '2 minutes' where id=j.id returning * into j;return to_jsonb(j);
end $$;
revoke all on function public.candidate_claim_job() from public,anon,authenticated;
grant execute on function public.candidate_claim_job() to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('candidate-files','candidate-files',false,10485760,array['image/jpeg','image/png','image/webp','image/avif','image/gif','application/pdf']) on conflict(id) do nothing;
create policy candidate_files_read on storage.objects for select to authenticated using(bucket_id='candidate-files' and exists(select 1 from public.candidate_files f where f.storage_path=storage.objects.name and private.candidate_access(f.account_id,false)));

create function public.candidate_hiring_options() returns jsonb language sql stable security definer set search_path=public,pg_catalog as $$
 select case when private.candidate_access(public.get_active_account_id(),false) then jsonb_build_object(
 'active_venue_id',(select active_venue_id from public.profiles where id=auth.uid()),
 'positions',coalesce((select jsonb_agg(x.desired_position order by x.desired_position) from (select distinct desired_position from public.candidates where account_id=public.get_active_account_id() and archived_at is null and status<>'hired' and nullif(trim(desired_position),'') is not null) x),'[]'),
 'venues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'timezone',v.timezone,'can_hire',private.candidate_venue_permission(auth.uid(),v.id,'people.invite_staff') and private.candidate_venue_permission(auth.uid(),v.id,'people.manage_candidates'),'can_create_role',private.candidate_venue_permission(auth.uid(),v.id,'people.manage_roles') and private.candidate_venue_permission(auth.uid(),v.id,'payroll.configure'))) from public.venues v where v.account_id=public.get_active_account_id() and v.archived_at is null),'[]'),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'venue_id',r.venue_id,'model_id',m.id,'quickresto_role_id',coalesce(m.quickresto_role_id,(select l.external_id::bigint from public.external_entity_links l where l.account_id=v.account_id and l.provider='quickresto' and l.entity_type='role' and l.local_id=r.id and l.external_id~'^[0-9]+$' limit 1)),'rules',coalesce((select jsonb_agg(jsonb_build_object('valid_from',rv.valid_from,'monthly_amount',rv.monthly_amount,'rates',rv.rates,'config',rv.config) order by rv.valid_from desc,rv.created_at desc,rv.id desc) from public.payroll_rule_versions rv where rv.model_id=m.id and rv.employee_id is null),'[]'))) from public.roles r join public.venues v on v.id=r.venue_id left join public.payroll_models m on m.role_id=r.id and m.is_role_default and not m.archived where v.account_id=public.get_active_account_id() and v.archived_at is null and r.archived_at is null and (private.candidate_venue_permission(auth.uid(),v.id,'people.manage_candidates') or private.candidate_venue_permission(auth.uid(),v.id,'payroll.configure'))),'[]'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',concat_ws(' ',p.first_name,p.last_name),'venue_id',v.id,'role_id',uv.role_id)) from public.profiles p join public.user_venue_roles uv on uv.user_id=p.id join public.venues v on v.id=uv.venue_id where v.account_id=public.get_active_account_id() and uv.status='active' and uv.fired_at is null),'[]'),
 'members',coalesce((select jsonb_agg(x) from (select distinct p.id,concat_ws(' ',p.first_name,p.last_name) as name from public.profiles p join public.user_venue_roles uv on uv.user_id=p.id join public.venues v on v.id=uv.venue_id where v.account_id=public.get_active_account_id() and uv.status='active' and uv.fired_at is null) x),'[]')
 ) else null end;
$$;
revoke all on function public.candidate_hiring_options() from public,anon;
grant execute on function public.candidate_hiring_options() to authenticated;

create function public.candidate_create_role(p_venue uuid,p_input jsonb) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();r uuid;m uuid;valid date:=(p_input->>'valid_from')::date;label text:=trim(p_input->>'name');template uuid:=nullif(p_input->>'copy_role_id','')::uuid;
begin
 if not private.candidate_access(a,true) or not exists(select 1 from public.venues where id=p_venue and account_id=a and archived_at is null) or not private.candidate_venue_permission(u,p_venue,'people.manage_roles') or not private.candidate_venue_permission(u,p_venue,'payroll.configure') then raise exception 'Нет прав создавать должности и условия оплаты в этом заведении';end if;
 if coalesce((p_input->>'monthly_amount')::numeric,-1)<0 or (p_input->>'monthly_amount')::numeric>1000000000 then raise exception 'Некорректный оклад';end if;
 if jsonb_typeof(p_input->'rates') is distinct from 'object' then raise exception 'Некорректные ставки';end if;
 if exists(select 1 from jsonb_each(p_input->'rates') counts cross join lateral jsonb_each(counts.value) days where coalesce((days.value->>'base')::numeric,-1)<0 or coalesce((days.value->>'percent')::numeric,-1)<0 or (days.value->>'percent')::numeric>100) then raise exception 'Проверьте ставки и проценты';end if;
 if length(label) not between 2 and 100 or valid is null or extract(day from valid)<>1 then raise exception 'Укажите название и первое число месяца начала условий';end if;
 if template is not null and not exists(select 1 from public.roles where id=template and venue_id=p_venue and archived_at is null) then raise exception 'Образец должности недоступен';end if;
 insert into public.roles(venue_id,name,code,icon,icon_color) values(p_venue,label,'custom_'||replace(gen_random_uuid()::text,'-',''),'user','blue') returning id into r;
 if template is not null then insert into public.role_permissions(role_id,permission_id,granted) select r,permission_id,granted from public.role_permissions where role_id=template on conflict do nothing;end if;
 insert into public.payroll_models(account_id,venue_id,name,role_name,role_id,is_role_default,basis,monthly_amount,tips,experience,quickresto_role_id) values(a,p_venue,label,label,r,true,coalesce(p_input->>'basis','none'),0,coalesce((p_input->>'tips')::boolean,false),false,nullif(p_input->>'quickresto_role_id','')::bigint) returning id into m;
 insert into public.payroll_rule_versions(account_id,venue_id,model_id,valid_from,rates,experience_steps,monthly_amount,tenure_requires_exam,config,created_by,change_reason)
 values(a,p_venue,m,valid,coalesce(p_input->'rates','{}'),'{}',coalesce((p_input->>'monthly_amount')::numeric,0),true,
 jsonb_build_object('basis',coalesce(p_input->>'basis','none'),'tips',coalesce((p_input->>'tips')::boolean,false),'shift_pay',coalesce((p_input->>'shift_pay')::boolean,false),'experience',false,'extras_enabled',false,'knowledge_amount',coalesce((p_input->>'knowledge_amount')::numeric,0),'food_amount',coalesce((p_input->>'food_amount')::numeric,0),'cleaner_bonus',0),u,'Новая должность при найме кандидата');
 return r;
end $$;
revoke all on function public.candidate_create_role(uuid,jsonb) from public,anon;
grant execute on function public.candidate_create_role(uuid,jsonb) to authenticated;

create unique index candidate_notification_once on public.notifications(user_id,entity_id,type) where entity_type='candidate' and type='candidate.new';
create function public.candidate_notify_in_app(p_candidate uuid) returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare c public.candidates;
begin
 select * into c from public.candidates where id=p_candidate;
 if not found then return;end if;
 insert into public.notifications(user_id,venue_id,type,title,body,link,category,entity_type,entity_id)
 select distinct on(recipient.user_id) recipient.user_id,recipient.venue_id,'candidate.new','Новая анкета: '||c.full_name,coalesce(c.desired_position,''),'/people/candidates/'||c.id,'staff','candidate',c.id
 from (
 select a.owner_id as user_id,v.id as venue_id from public.accounts a join lateral (select id from public.venues where account_id=a.id and archived_at is null order by id limit 1) v on true where a.id=c.account_id
 union all
 select uv.user_id,uv.venue_id from public.user_venue_roles uv join public.venues v on v.id=uv.venue_id
 where v.account_id=c.account_id and v.archived_at is null and uv.status='active' and uv.fired_at is null and private.candidate_venue_permission(uv.user_id,v.id,'people.manage_candidates')
 ) recipient order by recipient.user_id,recipient.venue_id
 on conflict(user_id,entity_id,type) where entity_type='candidate' and type='candidate.new' do nothing;
end $$;
revoke all on function public.candidate_notify_in_app(uuid) from public,anon,authenticated;
grant execute on function public.candidate_notify_in_app(uuid) to service_role;
notify pgrst,'reload schema';

-- Provisioning runs outside Auth/Postgres transactions. Reserve before any external POST.
create function public.candidate_claim_hire(p_hire uuid) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare h public.candidate_hires;begin
 select * into h from public.candidate_hires where id=p_hire for update;
 if not found or h.state='complete' then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(h.account_id::text,1926));
 if h.lease_until>now() or exists(select 1 from public.candidate_hires other where other.account_id=h.account_id and other.id<>h.id and other.lease_until>now()) then return null;end if;
 update public.candidate_hires set lease_until=now()+interval '4 minutes',error=null where id=h.id returning * into h;
 return to_jsonb(h);
end $$;
revoke all on function public.candidate_claim_hire(uuid) from public,anon,authenticated;
grant execute on function public.candidate_claim_hire(uuid) to service_role;
-- Office allocation is serialized against both imported and newly-issued codes.
create table public.staff_door_reserved (
 account_id uuid not null references public.accounts(id) on delete cascade,kind text not null check(kind in ('user','password')),value text not null,
 primary key(account_id,kind,value)
);
alter table public.staff_door_reserved enable row level security;
revoke all on public.staff_door_reserved from public,anon,authenticated;
create function public.candidate_reserve_door(p_hire uuid,p_number int,p_hash text,p_secret jsonb) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare h public.candidate_hires;ident uuid;begin
 select * into h from public.candidate_hires where id=p_hire for update;
 if not found or not exists(select 1 from public.candidate_employment_settings where account_id=h.account_id and venue_id=(h.input->>'venue_id')::uuid and office_pool_initialized) then raise exception 'Сначала перенесите занятые коды офисного замка';end if;
 select id into ident from public.staff_door_codes where hire_id=h.id;if ident is not null then return ident;end if;
 insert into public.staff_door_reserved(account_id,kind,value) values(h.account_id,'user',p_number::text),(h.account_id,'password',p_hash);
 insert into public.staff_door_codes(account_id,hire_id,user_number,password_hash,password_secret,source) values(h.account_id,h.id,p_number,p_hash,p_secret,'sheerly') returning id into ident;return ident;
end $$;
revoke all on function public.candidate_reserve_door(uuid,int,text,jsonb) from public,anon,authenticated;
grant execute on function public.candidate_reserve_door(uuid,int,text,jsonb) to service_role;

alter policy candidate_read on public.candidates using(private.candidate_access(account_id,false) and (archived_at is null or exists(select 1 from public.accounts a where a.id=account_id and a.owner_id=(select auth.uid()))));
do $$declare t text;begin foreach t in array array['candidate_comments','candidate_appointments','candidate_files','candidate_events'] loop
 execute format('alter policy candidate_read on public.%I using(private.candidate_access(account_id,false) and exists(select 1 from public.candidates c where c.account_id=%I.account_id and c.id=%I.candidate_id))',t,t,t);
end loop;end $$;
create function public.candidate_guard_responsible() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if new.responsible_id is not null and not exists(select 1 from public.user_venue_roles uv join public.venues v on v.id=uv.venue_id where uv.user_id=new.responsible_id and v.account_id=new.account_id and uv.status='active' and uv.fired_at is null) then raise exception 'Ответственный недоступен в аккаунте';end if;return new;
end $$;
create trigger candidate_responsible before insert or update of responsible_id on public.candidates for each row execute function public.candidate_guard_responsible();

create function public.candidate_link_staff(p_candidate uuid,p_user uuid,p_venue uuid,p_revision int) returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;r uuid;
begin
 if u is null or a is null or not public.has_permission('people.manage_candidates') or not private.candidate_venue_permission(u,p_venue,'people.invite_staff') or not exists(select 1 from public.venues where id=p_venue and account_id=a and archived_at is null) then raise exception 'Нет права связывать кандидата с сотрудником';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a and archived_at is null for update;
 if not found then raise exception 'Кандидат недоступен';end if;
 if c.hired_user_id=p_user and c.hired_venue_id=p_venue then return p_user;end if;
 if c.revision is distinct from p_revision or c.status='hired' or exists(select 1 from public.candidate_hires where candidate_id=c.id) then raise exception 'Анкета или оформление уже изменены';end if;
 select role_id into r from public.user_venue_roles where user_id=p_user and venue_id=p_venue and status='active' and fired_at is null;
 if r is null then raise exception 'Сотрудник не работает в выбранном заведении';end if;
 update public.candidates set status='hired',hired_user_id=p_user,hired_venue_id=p_venue,hired_role_id=r,hired_at=now(),hired_by=u where id=c.id;
 return p_user;
end $$;
revoke all on function public.candidate_link_staff(uuid,uuid,uuid,int) from public,anon;
grant execute on function public.candidate_link_staff(uuid,uuid,uuid,int) to authenticated;

-- One tab permission; hiring still requires people.invite_staff at the destination.
create index candidates_new_count on public.candidates(account_id) where archived_at is null and status='new';
create function public.candidate_new_count() returns integer language sql stable security invoker set search_path=public,pg_catalog as $$
 select count(*)::integer from public.candidates where account_id=public.get_active_account_id() and archived_at is null and status='new'
$$;
revoke all on function public.candidate_new_count() from public,anon;
grant execute on function public.candidate_new_count() to authenticated;

-- Business events are mirrored atomically into the shared journal.
create function public.candidate_event_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare c public.candidates;d jsonb;code text;part text;person uuid;
begin
 if new.kind not in ('created','commented','appointment_created','appointment_updated','file_added') then return new;end if;
 select * into c from public.candidates where id=new.candidate_id and account_id=new.account_id;
 if not found then return new;end if;
 d:=new.details||jsonb_build_object('name',c.full_name,'candidate_event_id',new.id);
 if new.kind='file_added' then d:=d||jsonb_build_object('name_of_file',new.details->>'name');end if;
 if new.kind in ('appointment_created','appointment_updated') then
 foreach part in array array['before','after'] loop
 person:=nullif(d->part->>'interviewer_id','')::uuid;
 if person is not null then d:=jsonb_set(d,array[part,'interviewer_name'],to_jsonb(coalesce((select nullif(concat_ws(' ',first_name,last_name),'') from public.profiles where id=person),'Сотрудник')));end if;
 end loop;
 end if;
 code:=case new.kind when 'appointment_created' then 'candidate.appointment.created' when 'appointment_updated' then 'candidate.appointment.updated' when 'file_added' then 'candidate.file.created' else 'candidate.'||new.kind end;
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(c.account_id,new.actor_id,code,'candidate',c.id,d);
 return new;
end $$;
revoke all on function public.candidate_event_audit() from public,anon,authenticated;
create trigger candidate_event_shared_audit after insert on public.candidate_events for each row execute function public.candidate_event_audit();

create function public.candidate_configuration_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare before_data jsonb:='{}';after_data jsonb;changes jsonb:='{}';k text;label text;code text;
begin
 if TG_TABLE_NAME='candidate_connections' then
 if TG_OP='UPDATE' then before_data:=jsonb_build_object('form_id',old.form_id,'enabled',old.enabled,'telegram_chat_id',old.telegram_chat_id,'telegram_configured',old.telegram_secret is not null);end if;
 after_data:=jsonb_build_object('form_id',new.form_id,'enabled',new.enabled,'telegram_chat_id',new.telegram_chat_id,'telegram_configured',new.telegram_secret is not null);
 if TG_OP='UPDATE' and new.secret_hash is distinct from old.secret_hash then changes:=changes||jsonb_build_object('webhook_secret',jsonb_build_object('old','Настроен','new','Обновлён'));end if;
 if TG_OP='UPDATE' and new.telegram_secret is distinct from old.telegram_secret then changes:=changes||jsonb_build_object('telegram_token',jsonb_build_object('old','Настроен','new','Обновлён'));end if;
 label:='Приём заявок из Тильды';code:='candidate.connection.updated';
 else
 if TG_OP='UPDATE' then before_data:=to_jsonb(old)-'account_id'-'venue_id';end if;
 after_data:=to_jsonb(new)-'account_id'-'venue_id';
 label:=coalesce((select name from public.venues where id=new.venue_id),'Заведение');code:='candidate.employment_settings.updated';
 end if;
 for k in select jsonb_object_keys(after_data) loop
 if before_data->k is distinct from after_data->k then changes:=changes||jsonb_build_object(k,jsonb_build_object('old',before_data->k,'new',after_data->k));end if;
 end loop;
 if changes<>'{}' then insert into public.audit_logs(account_id,user_id,action_code,entity_type,details) values(new.account_id,auth.uid(),code,'candidate',jsonb_build_object('name',label,'changes',changes));end if;
 return new;
end $$;
revoke all on function public.candidate_configuration_audit() from public,anon,authenticated;
create trigger candidate_connection_audit after insert or update on public.candidate_connections for each row execute function public.candidate_configuration_audit();
create trigger candidate_employment_settings_audit after insert or update on public.candidate_employment_settings for each row execute function public.candidate_configuration_audit();

-- Old notifications and journal entries also obey the current tab permission.
create policy candidate_notification_access on public.notifications as restrictive for select to authenticated using (
 entity_type is distinct from 'candidate' or exists(select 1 from public.candidates c where c.id=notifications.entity_id and private.candidate_access(c.account_id,false))
);
create policy candidate_shared_audit_access on public.audit_logs as restrictive for select to authenticated using (
 action_code not like 'candidate.%' or private.candidate_access(account_id,false)
);
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='candidates') then
 alter publication supabase_realtime add table public.candidates;
 end if;
end $$;
notify pgrst,'reload schema';
