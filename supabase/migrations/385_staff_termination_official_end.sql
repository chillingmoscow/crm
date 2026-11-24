-- 385: увольнение в приложении ставит дату официального увольнения.
-- Тело — из 315:216 целиком; добавлены переменная ended и блок после «payroll_employees set active=false».
begin;

create or replace function public.staff_begin_termination(p_uvr uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u public.user_venue_roles;a uuid;job public.staff_terminations;e public.payroll_employees;
 employee bigint;guest bigint;bonus bigint;shared boolean;door boolean;ids bigint[];rs public.staff_restorations;abandoned boolean:=false;tg text;ended public.payroll_official_employments;
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
 select * into job from public.staff_terminations where uvr_id=u.id order by created_at desc,id desc limit 1 for update;
 if found and u.status='fired' and job.state<>'cancelled' and not abandoned then
 -- Manual «Повторить» (permission-checked, with an actor) is the only path that refreshes the
 -- Telegram ID snapshot; the worker never reads the live profile the fired person could edit.
 if job.state<>'complete' then
 tg:=(select nullif(trim(p.telegram_id),'') from public.profiles p where p.id=u.user_id);
 if tg is distinct from job.telegram_id then
 -- Never swap the identity under a running worker (same minute of grace as the restore).
 if job.lease_until>now()-interval '1 minute' then raise exception 'Увольнение сейчас обрабатывается, повторите через минуту';end if;
 -- Journal results and Telegram step markers describe the old identity: the corrected
 -- person must be checked in every chat again. An expired 'working' attempt is released,
 -- so its leased writes (state + attempts guard) stop instead of restoring old markers.
 delete from public.staff_telegram_actions where account_id=a and kind='remove' and event_key='termination:'||job.id;
 update public.staff_terminations set telegram_id=tg,lease_until=null,
 state=case when state='working' then 'pending' else state end,
 steps=steps-'telegram'-'telegram_skipped'-'telegram_report'-'telegram_report_skipped'
 where id=job.id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,u.venue_id,auth.uid(),'staff.termination_telegram_id','staff',u.user_id,
 jsonb_build_object('termination_id',job.id,'before',job.telegram_id,'after',tg));
 end if;
 end if;
 return job.id;
 end if;
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
 insert into public.staff_terminations(account_id,venue_id,uvr_id,user_id,actor_id,reason,employee_id,guest_id,bonus_id,shared_access,door_revoked,state,completed_at,telegram_id)
 values(a,u.venue_id,u.id,u.user_id,auth.uid(),trim(p_reason),employee,guest,bonus,shared,door,
 case when shared then 'complete' else 'pending' end,
 case when shared then now() end,
 (select nullif(trim(p.telegram_id),'') from public.profiles p where p.id=u.user_id)) returning * into job;
 if u.status='active' then update public.user_venue_roles set status='fired',fired_at=now(),fired_reason=trim(p_reason) where id=u.id;end if;
 update public.payroll_employees set active=false where account_id=a and venue_id=u.venue_id and local_user_id=u.user_id;
 -- Official employment: the dismissal date (account time zone) closes the person's open official periods,
 -- so the month goes to review instead of an automatic full payment. A date already set is never touched.
 for ended in
 with closed as (
 update public.payroll_official_employments o
 set ends_on=greatest(private.finance_account_today(a),o.starts_on),updated_by=auth.uid(),updated_at=now()
 where o.account_id=a and o.venue_id=u.venue_id and o.archived_at is null and o.ends_on is null
 and o.employee_id in (select pe.id from public.payroll_employees pe where pe.account_id=a and pe.venue_id=u.venue_id and pe.local_user_id=u.user_id)
 returning o.*)
 select * from closed
 loop
 perform private.payroll_official_audit(ended,auth.uid(),'payroll.official_employment.ended',
 jsonb_build_object('ends_on',ended.ends_on,'previous_ends_on',null,'source','termination'));
 end loop;
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

commit;
