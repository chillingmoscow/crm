-- Dismissal preserves history and removes external access through a durable job.
alter table public.staff_door_codes add column revoked_at timestamptz;
alter table public.staff_door_codes add column revoked_by uuid references public.profiles(id);
create table public.staff_terminations (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),venue_id uuid not null references public.venues(id),
 uvr_id uuid not null references public.user_venue_roles(id),user_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),reason text not null,
 employee_id bigint,guest_id bigint,bonus_id bigint,shared_access boolean not null default false,
 door_revoked boolean not null default false,
 state text not null default 'pending' check(state in ('pending','working','error','complete')),
 steps jsonb not null default '{}',error text,attempts integer not null default 0,
 available_at timestamptz not null default now(),lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz
);
alter table public.staff_terminations enable row level security;
revoke all on public.staff_terminations from public,anon,authenticated;
grant all on public.staff_terminations to service_role;
create index staff_terminations_pending on public.staff_terminations(available_at) where state<>'complete';
create unique index staff_terminations_one_pending on public.staff_terminations(uvr_id) where state<>'complete';

create function public.staff_begin_termination(p_uvr uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u public.user_venue_roles;a uuid;job public.staff_terminations;e public.payroll_employees;
 employee bigint;guest bigint;bonus bigint;shared boolean;door boolean;ids bigint[];
begin
 select * into u from public.user_venue_roles where id=p_uvr for update;
 select account_id into a from public.venues where id=u.venue_id;
 if a is distinct from public.get_active_account_id() or auth.uid() is null
 or not private.candidate_venue_permission(auth.uid(),u.venue_id,'people.edit_staff') then raise exception 'Нет права увольнять сотрудника';end if;
 if u.user_id=auth.uid() or exists(select 1 from public.accounts where id=a and owner_id=u.user_id) then raise exception 'Владельца и себя нельзя уволить';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||u.user_id::text,0));
 select * into job from public.staff_terminations where uvr_id=u.id order by created_at desc,id desc limit 1;
 if found and u.status='fired' then return job.id;end if;
 if found and job.state<>'complete' then raise exception 'Предыдущее увольнение ещё не завершено';end if;
 if u.status<>'active' then raise exception 'Сотрудник уже уволен';end if;
 if length(trim(p_reason)) not between 1 and 2000 then raise exception 'Укажите причину увольнения (до 2000 символов)';end if;
 select * into e from public.payroll_employees where account_id=a and venue_id=u.venue_id and local_user_id=u.user_id;
 select array_agg(distinct ident) into ids from (
 select e.quickresto_id ident union all select external_id::bigint from public.external_entity_links
 where account_id=a and provider='quickresto' and entity_type='staff' and local_id=u.user_id and external_id~'^[0-9]+$') x where ident is not null;
 if cardinality(ids)>1 then raise exception 'Связи Quick Resto расходятся. Проверьте карточку сотрудника';end if;
 employee:=ids[1];guest:=e.quickresto_guest_id;bonus:=e.quickresto_bonus_account_id;
 -- Preserve account-wide access while the same person works at another venue.
 shared:=exists(select 1 from public.user_venue_roles x join public.venues v on v.id=x.venue_id
 where x.user_id=u.user_id and x.id<>u.id and x.status='active' and v.account_id=a);
 if not shared and exists(select 1 from public.payroll_employees x where x.account_id=a and x.local_user_id is distinct from u.user_id
 and ((employee is not null and x.quickresto_id=employee) or (guest is not null and x.quickresto_guest_id=guest) or (bonus is not null and x.quickresto_bonus_account_id=bonus))) then
 raise exception 'Внешние записи связаны с другим сотрудником. Удаление остановлено';end if;
 if not shared and exists(select 1 from public.candidate_hires x where x.account_id=a and x.target_user_id<>u.user_id
 and ((employee is not null and x.provisioning#>>'{employee,id}'=employee::text) or (guest is not null and x.provisioning#>>'{guest,id}'=guest::text))) then
 raise exception 'Внешние записи используются другим наймом. Удаление остановлено';end if;
 door:=not shared and exists(select 1 from public.staff_door_codes where account_id=a and user_id=u.user_id and revoked_at is null);
 insert into public.staff_terminations(account_id,venue_id,uvr_id,user_id,actor_id,reason,employee_id,guest_id,bonus_id,shared_access,door_revoked,state,completed_at)
 values(a,u.venue_id,u.id,u.user_id,auth.uid(),trim(p_reason),employee,guest,bonus,shared,door,
 case when shared or (employee is null and guest is null) then 'complete' else 'pending' end,
 case when shared or (employee is null and guest is null) then now() end) returning * into job;
 update public.user_venue_roles set status='fired',fired_at=now(),fired_reason=trim(p_reason) where id=u.id;
 update public.payroll_employees set active=false where account_id=a and venue_id=u.venue_id and local_user_id=u.user_id;
 delete from public.schedule_qualifications where venue_id=u.venue_id and user_id=u.user_id;
 delete from public.invitations where venue_id=u.venue_id and status='pending' and lower(email)=(select lower(email) from auth.users where id=u.user_id);
 if not shared then
 update public.staff_door_codes set revoked_at=now(),revoked_by=auth.uid(),password_secret=null where account_id=a and user_id=u.user_id and revoked_at is null;
 end if;
 -- Keep number/hash reservations: an old physical code must never be reissued.
 return job.id;
end $$;
revoke all on function public.staff_begin_termination(uuid,text) from public,anon;
grant execute on function public.staff_begin_termination(uuid,text) to authenticated;

create function public.staff_claim_termination(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.staff_terminations;
begin
 select * into j from public.staff_terminations where (p_id is null or id=p_id) and state<>'complete'
 and (lease_until is null or lease_until<now()) and (p_id is not null or (available_at<=now() and attempts<5))
 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 -- Never remove shared identities after a reactivation or concurrent new membership.
 if exists(select 1 from public.user_venue_roles u join public.venues v on v.id=u.venue_id where u.user_id=j.user_id and u.status='active' and v.account_id=j.account_id) then
 update public.staff_terminations set state='error',error='Сотрудник снова активен: требуется проверка',attempts=5,lease_until=null where id=j.id;return null;end if;
 update public.staff_terminations set state='working',attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.staff_claim_termination(uuid) from public,anon,authenticated;
grant execute on function public.staff_claim_termination(uuid) to service_role;

create function private.staff_termination_guard() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if old.status='active' and new.status='fired' and not exists(select 1 from public.staff_terminations t where t.uvr_id=old.id) then
 raise exception 'Используйте команду увольнения с закрытием внешнего доступа';end if;
 if old.status='fired' and new.status='active' and exists(select 1 from public.staff_terminations t where t.uvr_id=old.id and not t.shared_access and (t.employee_id is not null or t.guest_id is not null or t.door_revoked)) then
 raise exception 'Внешний доступ закрыт. Для повторного найма нужно заново оформить Quick Resto и код замка';end if;
 return new;
end $$;
create trigger staff_termination_guard before update of status on public.user_venue_roles for each row execute function private.staff_termination_guard();
revoke all on function private.staff_termination_guard() from public,anon,authenticated;

create function private.staff_termination_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if old.state is distinct from 'complete' and new.state='complete' then
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,new.actor_id,'staff.access_removed','staff',new.user_id,
 jsonb_build_object('termination_id',new.id,'quickresto_employee_id',new.employee_id,'quickresto_guest_id',new.guest_id,'quickresto_bonus_id',new.bonus_id,'door_revoked',new.door_revoked));
 end if;return new;
end $$;
create trigger staff_termination_audit after update of state on public.staff_terminations for each row execute function private.staff_termination_audit();
revoke all on function private.staff_termination_audit() from public,anon,authenticated;
