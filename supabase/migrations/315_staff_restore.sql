-- «Вернуть сотрудника»: a durable restore process mirroring dismissal (276).
-- The previous Quick Resto employee and guest are recovered, the guest gets the Staff
-- group and a new bonus account, a new door code is issued, then the local status flips
-- and chat invitations are queued. Starting a restore cancels an unfinished dismissal job
-- so the person can be dismissed again later; a dismissal likewise abandons an unfinished
-- restore. Workers write only while the job is still their attempt (state + attempts).

alter table public.staff_terminations drop constraint staff_terminations_state_check;
alter table public.staff_terminations add constraint staff_terminations_state_check
 check(state in ('pending','working','error','complete','cancelled'));
drop index public.staff_terminations_pending;
create index staff_terminations_pending on public.staff_terminations(available_at) where state not in ('complete','cancelled');
drop index public.staff_terminations_one_pending;
create unique index staff_terminations_one_pending on public.staff_terminations(uvr_id) where state not in ('complete','cancelled');

create table public.staff_restorations (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),venue_id uuid not null,
 uvr_id uuid not null references public.user_venue_roles(id),user_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id),termination_id uuid references public.staff_terminations(id),
 employee_id bigint,guest_id bigint,bonus_id bigint,shared_access boolean not null default false,
 door_needed boolean not null default false,door_code_id uuid references public.staff_door_codes(id),
 state text not null default 'pending' check(state in ('pending','working','error','complete','cancelled')),
 steps jsonb not null default '{}',error text,attempts integer not null default 0,
 available_at timestamptz not null default now(),lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 unique(account_id,id),
 foreign key(account_id,venue_id) references public.venues(account_id,id)
);
alter table public.staff_restorations enable row level security;
revoke all on public.staff_restorations from public,anon,authenticated;
grant all on public.staff_restorations to service_role;
create index staff_restorations_account_venue on public.staff_restorations(account_id,venue_id);
create index staff_restorations_pending on public.staff_restorations(available_at) where state not in ('complete','cancelled');
create unique index staff_restorations_one_open on public.staff_restorations(uvr_id) where state not in ('complete','cancelled');
create index staff_restorations_uvr on public.staff_restorations(uvr_id);
create index staff_restorations_user on public.staff_restorations(user_id);
create index staff_restorations_actor on public.staff_restorations(actor_id);
create index staff_restorations_termination on public.staff_restorations(termination_id);
create index staff_restorations_door_code on public.staff_restorations(door_code_id);

-- Local part of a restore; the only path that flips a QR-closed dismissal back to active.
create function private.staff_apply_restore(p_id uuid,p_bonus bigint) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.staff_restorations;u public.user_venue_roles;
begin
 select * into r from public.staff_restorations where id=p_id for update;
 if not found then raise exception 'Возврат не найден';end if;
 if r.state='complete' then return;end if;
 if r.state='cancelled' then raise exception 'Возврат отменён';end if;
 select * into u from public.user_venue_roles where id=r.uvr_id for update;
 if u.status is distinct from 'fired' then raise exception 'Статус сотрудника изменился: требуется проверка';end if;
 -- Marked complete first: the status guard accepts a complete restore newer than the dismissal.
 update public.staff_restorations set state='complete',completed_at=now(),error=null,lease_until=null,bonus_id=coalesce(p_bonus,bonus_id) where id=r.id;
 update public.user_venue_roles set status='active',fired_at=null,fired_reason=null where id=u.id;
 update public.payroll_employees set active=true,quickresto_bonus_account_id=coalesce(p_bonus,quickresto_bonus_account_id)
 where account_id=r.account_id and venue_id=r.venue_id and local_user_id=r.user_id;
 insert into public.schedule_qualifications(venue_id,user_id,role_id) values(r.venue_id,r.user_id,u.role_id) on conflict do nothing;
 -- The status trigger logs staff.restored; a service-role finish has no session actor.
 update public.audit_logs set user_id=r.actor_id,details=details||jsonb_build_object('restoration_id',r.id)
 where account_id=r.account_id and entity_id=r.user_id and action_code='staff.restored' and details->>'uvr_id'=u.id::text
 and created_at>=r.created_at and (user_id is null or user_id=r.actor_id);
 -- Shared access never left the chats; everyone else is invited again (one job per restore).
 if not r.shared_access then
 insert into public.candidate_jobs(account_id,kind,payload)
 select r.account_id,'chat_invites',jsonb_build_object('user_id',r.user_id,'role_id',u.role_id,
  'name',trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),'event_key','restore:'||r.id)
 from public.profiles p where p.id=r.user_id
 and not exists(select 1 from public.candidate_jobs j where j.account_id=r.account_id and j.kind='chat_invites' and j.payload->>'event_key'='restore:'||r.id);
 end if;
end $$;
revoke all on function private.staff_apply_restore(uuid,bigint) from public,anon,authenticated;

create function public.staff_begin_restore(p_uvr uuid) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u public.user_venue_roles;a uuid;t public.staff_terminations;r public.staff_restorations;e public.payroll_employees;
 employee bigint;guest bigint;shared boolean;remote boolean;
begin
 select * into u from public.user_venue_roles where id=p_uvr for update;
 select account_id into a from public.venues where id=u.venue_id;
 if a is distinct from public.get_active_account_id() or auth.uid() is null
 or not private.candidate_venue_permission(auth.uid(),u.venue_id,'people.edit_staff') then raise exception 'Нет права возвращать сотрудника';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||u.user_id::text,0));
 -- An unfinished restore is continued (manual «Повторить»), never duplicated.
 select * into r from public.staff_restorations where uvr_id=u.id and state not in ('complete','cancelled') order by created_at desc limit 1;
 if found then
 if r.lease_until>now() then raise exception 'Возврат уже выполняется. Обновите карточку через минуту';end if;
 return r.id;
 end if;
 if u.status<>'fired' then raise exception 'Сотрудник не уволен';end if;
 if exists(select 1 from public.staff_terminations where uvr_id=u.id and state not in ('complete','cancelled') and lease_until>now()) then
 raise exception 'Увольнение ещё выполняется. Повторите возврат через несколько минут';end if;
 update public.staff_terminations set state='cancelled',error='Отменено возвратом сотрудника',lease_until=null,completed_at=now()
 where uvr_id=u.id and state not in ('complete','cancelled');
 select * into t from public.staff_terminations where uvr_id=u.id order by created_at desc,id desc limit 1;
 select * into e from public.payroll_employees where account_id=a and venue_id=u.venue_id and local_user_id=u.user_id;
 -- Current sharing only decides invitations; what must come back is what the dismissal removed.
 shared:=exists(select 1 from public.user_venue_roles x join public.venues v on v.id=x.venue_id
 where x.user_id=u.user_id and x.id<>u.id and x.status='active' and v.account_id=a);
 remote:=t.id is not null and not t.shared_access and (t.employee_id is not null or t.guest_id is not null or t.bonus_id is not null or t.door_revoked);
 if remote then
 employee:=coalesce(e.quickresto_id,t.employee_id);guest:=coalesce(e.quickresto_guest_id,t.guest_id);
 if (t.employee_id is not null and t.employee_id<>employee) or (t.guest_id is not null and t.guest_id<>guest) then
 raise exception 'Связи Quick Resto расходятся. Проверьте карточку сотрудника';end if;
 if exists(select 1 from public.payroll_employees x where x.account_id=a and x.local_user_id is distinct from u.user_id
 and ((employee is not null and x.quickresto_id=employee) or (guest is not null and x.quickresto_guest_id=guest))) then
 raise exception 'Записи Quick Resto связаны с другим сотрудником. Возврат остановлен';end if;
 -- Every local precondition is checked before the first Quick Resto write.
 if (employee is not null or guest is not null or t.door_revoked) and not exists(select 1 from public.candidate_employment_settings where account_id=a and venue_id=u.venue_id) then
 raise exception 'Заполните настройки приёма для заведения: группа Staff, бонусный счёт, склады';end if;
 if t.door_revoked and not exists(select 1 from public.candidate_employment_settings where account_id=a and venue_id=u.venue_id and office_pool_initialized) then
 raise exception 'Сначала перенесите занятые коды офисного замка';end if;
 end if;
 insert into public.staff_restorations(account_id,venue_id,uvr_id,user_id,actor_id,termination_id,employee_id,guest_id,shared_access,door_needed,state)
 values(a,u.venue_id,u.id,u.user_id,auth.uid(),t.id,employee,guest,shared,remote and t.door_revoked,case when remote then 'pending' else 'working' end)
 returning * into r;
 if not remote then perform private.staff_apply_restore(r.id,null);end if;
 return r.id;
end $$;
revoke all on function public.staff_begin_restore(uuid) from public,anon;
grant execute on function public.staff_begin_restore(uuid) to authenticated;

create function public.staff_claim_restore(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.staff_restorations;
begin
 select * into j from public.staff_restorations where (p_id is null or id=p_id) and state not in ('complete','cancelled')
 and (lease_until is null or lease_until<now()) and (p_id is not null or (available_at<=now() and attempts<5))
 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 if not exists(select 1 from public.user_venue_roles where id=j.uvr_id and status='fired') then
 update public.staff_restorations set state='error',error='Статус сотрудника изменился: требуется проверка',attempts=5,lease_until=null where id=j.id;return null;end if;
 update public.staff_restorations set state='working',attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('role_id',(select role_id from public.user_venue_roles where id=j.uvr_id));
end $$;
revoke all on function public.staff_claim_restore(uuid) from public,anon,authenticated;
grant execute on function public.staff_claim_restore(uuid) to service_role;

-- A new code from the pool for an existing employee (the hire variant is keyed by hire).
create function public.staff_restore_reserve_door(p_restore uuid,p_attempts int,p_number int,p_hash text,p_secret jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.staff_restorations;ident uuid;
begin
 select * into r from public.staff_restorations where id=p_restore for update;
 if not found or r.state<>'working' or r.attempts<>p_attempts then raise exception 'Возврат отменён или перехвачен другим обработчиком';end if;
 if r.door_code_id is not null then return r.door_code_id;end if;
 if not exists(select 1 from public.candidate_employment_settings where account_id=r.account_id and venue_id=r.venue_id and office_pool_initialized) then
 raise exception 'Сначала перенесите занятые коды офисного замка';end if;
 insert into public.staff_door_reserved(account_id,kind,value) values(r.account_id,'user',p_number::text),(r.account_id,'password',p_hash);
 insert into public.staff_door_codes(account_id,user_id,user_number,password_hash,password_secret,source)
 values(r.account_id,r.user_id,p_number,p_hash,p_secret,'sheerly') returning id into ident;
 update public.staff_restorations set door_code_id=ident where id=r.id;
 return ident;
end $$;
revoke all on function public.staff_restore_reserve_door(uuid,int,int,text,jsonb) from public,anon,authenticated;
grant execute on function public.staff_restore_reserve_door(uuid,int,int,text,jsonb) to service_role;

create function public.staff_finish_restore(p_restore uuid,p_bonus bigint,p_attempts int) returns void
language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.staff_restorations;
begin
 select * into r from public.staff_restorations where id=p_restore for update;
 if not found then raise exception 'Возврат не найден';end if;
 if r.state='complete' then return;end if;
 if r.state<>'working' or r.attempts<>p_attempts then raise exception 'Возврат отменён или перехвачен другим обработчиком';end if;
 if r.door_needed and r.door_code_id is null then raise exception 'Новый код замка не выдан';end if;
 if r.guest_id is not null and p_bonus is null then raise exception 'Новый бонусный счёт не подтверждён';end if;
 perform private.staff_apply_restore(r.id,p_bonus);
end $$;
revoke all on function public.staff_finish_restore(uuid,bigint,int) from public,anon,authenticated;
grant execute on function public.staff_finish_restore(uuid,bigint,int) to service_role;

-- Status guard: a dismissal must go through the command; a QR-closed dismissal comes back
-- only through a completed restore that is newer than it.
create or replace function private.staff_termination_guard() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare closed_at timestamptz;
begin
 if old.status='active' and new.status='fired' and not exists(select 1 from public.staff_terminations t where t.uvr_id=old.id and t.state<>'cancelled'
 and not exists(select 1 from public.staff_restorations r where r.uvr_id=old.id and r.state='complete' and r.created_at>t.created_at)) then
 raise exception 'Используйте команду увольнения с закрытием внешнего доступа';end if;
 if old.status='fired' and new.status='active' then
 select max(t.created_at) into closed_at from public.staff_terminations t
 where t.uvr_id=old.id and not t.shared_access and (t.employee_id is not null or t.guest_id is not null or t.door_revoked);
 if closed_at is not null and not exists(select 1 from public.staff_restorations r where r.uvr_id=old.id and r.state='complete' and r.created_at>closed_at) then
 raise exception 'Внешний доступ закрыт. Верните сотрудника кнопкой «Восстановить»: она восстановит Quick Resto и код замка';end if;
 end if;
 return new;
end $$;
revoke all on function private.staff_termination_guard() from public,anon,authenticated;

create or replace function public.staff_claim_termination(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare j public.staff_terminations;
begin
 select * into j from public.staff_terminations where (p_id is null or id=p_id) and state not in ('complete','cancelled')
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

-- Same body as 314 except: an unfinished restore without a live lease is abandoned (cancelled)
-- and the dismissal runs again, removing whatever the restore recovered; a cancelled job
-- neither blocks nor is returned; an already fired person keeps the original date and reason.
create or replace function public.staff_begin_termination(p_uvr uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u public.user_venue_roles;a uuid;job public.staff_terminations;e public.payroll_employees;
 employee bigint;guest bigint;bonus bigint;shared boolean;door boolean;ids bigint[];rs public.staff_restorations;abandoned boolean:=false;
begin
 select * into u from public.user_venue_roles where id=p_uvr for update;
 select account_id into a from public.venues where id=u.venue_id;
 if a is distinct from public.get_active_account_id() or auth.uid() is null
 or not private.candidate_venue_permission(auth.uid(),u.venue_id,'people.edit_staff') then raise exception 'Нет права увольнять сотрудника';end if;
 if u.user_id=auth.uid() or exists(select 1 from public.accounts where id=a and owner_id=u.user_id) then raise exception 'Владельца и себя нельзя уволить';end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||u.user_id::text,0));
 select * into rs from public.staff_restorations where uvr_id=u.id and state not in ('complete','cancelled') order by created_at desc limit 1 for update;
 if found then
 -- A minute of grace past the lease: a worker that just overran it is still stopped by its own write guard.
 if rs.lease_until>now()-interval '1 minute' then raise exception 'Идёт возврат сотрудника. Дождитесь его завершения';end if;
 update public.staff_restorations set state='cancelled',error='Отменено увольнением',lease_until=null,completed_at=now() where id=rs.id;
 abandoned:=true;
 end if;
 select * into job from public.staff_terminations where uvr_id=u.id order by created_at desc,id desc limit 1;
 if found and u.status='fired' and job.state<>'cancelled' and not abandoned then return job.id;end if;
 if found and job.state not in ('complete','cancelled') then raise exception 'Предыдущее увольнение ещё не завершено';end if;
 if u.status<>'active' and not (abandoned and u.status='fired') then raise exception 'Сотрудник уже уволен';end if;
 if length(trim(p_reason)) not between 1 and 2000 then raise exception 'Укажите причину увольнения (до 2000 символов)';end if;
 select * into e from public.payroll_employees where account_id=a and venue_id=u.venue_id and local_user_id=u.user_id;
 select array_agg(distinct ident) into ids from (
 select e.quickresto_id ident union all select external_id::bigint from public.external_entity_links
 where account_id=a and provider='quickresto' and entity_type='staff' and local_id=u.user_id and external_id~'^[0-9]+$') x where ident is not null;
 if cardinality(ids)>1 then raise exception 'Связи Quick Resto расходятся. Проверьте карточку сотрудника';end if;
 employee:=ids[1];guest:=e.quickresto_guest_id;bonus:=e.quickresto_bonus_account_id;
 -- The previous account was removed by the first dismissal; only the restore's new one is live.
 -- The worker removes every bonus account of the guest, so one created but not yet recorded goes too.
 if abandoned and u.status='fired' then bonus:=nullif(rs.steps->>'bonus','')::bigint;end if;
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
 case when shared then 'complete' else 'pending' end,
 case when shared then now() end) returning * into job;
 if u.status='active' then update public.user_venue_roles set status='fired',fired_at=now(),fired_reason=trim(p_reason) where id=u.id;end if;
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
