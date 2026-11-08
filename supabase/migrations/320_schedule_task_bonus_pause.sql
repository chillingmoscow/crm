begin;

create function private.schedule_task_bonus_enabled(p_account uuid,p_venue uuid,p_date date)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.schedule_task_settings st
   where st.account_id=p_account and st.venue_id=p_venue
     and st.legacy_stopped and not st.paused and st.enabled_from<=p_date)
$$;
revoke all on function private.schedule_task_bonus_enabled(uuid,uuid,date) from public,anon,authenticated;

-- A task bonus may already have been prepared or claimed when tasks are paused.
create or replace function public.payroll_claim_bonus_operation() returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;token uuid:=gen_random_uuid();
begin
 -- A process may have died after a POST. Such work must never be retried automatically.
 update public.payroll_bonus_operations set state='review',message='Ответ Quick Resto не подтверждён. Нужна сверка операции без повторного списания.' where state='sending' and claimed_at<now()-interval '3 minutes';
 -- A paused claim that never reached begin-send must not hold the loyalty account.
 update public.payroll_bonus_operations o set state='pending',lease_token=null,claimed_at=null
 from public.payroll_adjustments r where r.id=o.adjustment_id and o.state='reading'
   and r.origin='task' and not private.schedule_task_bonus_enabled(r.account_id,r.venue_id,r.business_date);
 select o.* into op from public.payroll_bonus_operations o join public.payroll_execution_policy p on p.venue_id=o.venue_id
 join public.venues v on v.id=o.venue_id
 join public.payroll_adjustments r on r.id=o.adjustment_id
 where p.legacy_stopped and p.bonus_from<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and r.business_date<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and o.policy_version=p.version and (o.state='pending' or (o.state='reading' and o.claimed_at<now()-interval '3 minutes'))
 and (r.origin<>'task' or private.schedule_task_bonus_enabled(r.account_id,r.venue_id,r.business_date))
 and not exists(select 1 from public.payroll_bonus_operations b where b.account_id=o.account_id and b.bonus_account_id=o.bonus_account_id and b.id<>o.id and b.state in ('reading','sending','review'))
 order by o.created_at,o.id for update of o skip locked limit 1;
 if op.id is null then return null;end if;
 -- Serialize across processes/venues sharing the same QR loyalty account.
 if not pg_try_advisory_xact_lock(hashtextextended('payroll-bonus:'||op.account_id||':'||op.bonus_account_id,0)) then return null;end if;
 if exists(select 1 from public.payroll_bonus_operations b where b.account_id=op.account_id and b.bonus_account_id=op.bonus_account_id and b.id<>op.id and b.state in ('reading','sending','review')) then return null;end if;
 update public.payroll_bonus_operations set state='reading',lease_token=token,claimed_at=now() where id=op.id;
 return to_jsonb(op)||jsonb_build_object('lease_token',token);
end $$;

create or replace function public.payroll_begin_bonus_send(p_id uuid,p_lease uuid,p_balance numeric) returns boolean language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;r public.payroll_adjustments;e public.payroll_employees;
begin
 select * into op from public.payroll_bonus_operations where id=p_id for update;
 if op.state is distinct from 'reading' or op.lease_token is distinct from p_lease then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(op.venue_id::text,0));
 select * into r from public.payroll_adjustments where id=op.adjustment_id for update;
 if r.origin='task' and not private.schedule_task_bonus_enabled(r.account_id,r.venue_id,r.business_date) then
  update public.payroll_bonus_operations set state='pending',lease_token=null,claimed_at=null where id=op.id;
  return false;
 end if;
 select * into e from public.payroll_employees where id=op.employee_id;
 if not exists(select 1 from public.payroll_execution_policy p where p.venue_id=op.venue_id and p.legacy_stopped and p.bonus_from<=(now() at time zone coalesce((select timezone from public.venues where id=op.venue_id),'Europe/Moscow'))::date and p.version=op.policy_version)
 or r.business_date>(now() at time zone coalesce((select timezone from public.venues where id=op.venue_id),'Europe/Moscow'))::date
 or r.deleted_at is not null or r.medium<>'bonus' or abs(r.amount)<>op.amount or r.employee_id<>op.employee_id
 or (op.operation='apply' and (e.quickresto_guest_id is distinct from op.guest_id or e.quickresto_bonus_account_id is distinct from op.bonus_account_id)) then
  update public.payroll_bonus_operations set state='review',message='Запись или счёт изменились. Нужна проверка.' where id=op.id;return false;
 end if;
 if p_balance is null or p_balance<0 or p_balance>1e12 then raise exception 'Не подтверждён бонусный баланс';end if;
 if op.direction='debit' and p_balance<op.amount then
  if op.operation='apply' and r.origin='lateness' then
   update public.payroll_bonus_operations set state='money',before_balance=p_balance,message='Бонусов недостаточно — весь штраф удержан деньгами',finished_at=now() where id=op.id;
   update public.payroll_adjustments set medium='money',external_state='not_required',bonus_balance_snapshot=p_balance,bonus_checked_at=now() where id=r.id;
  else
   update public.payroll_bonus_operations set state='review',before_balance=p_balance,message='Недостаточно бонусов для операции. Нужна проверка.' where id=op.id;
  end if;return false;
 end if;
 update public.payroll_bonus_operations set state='sending',before_balance=p_balance,claimed_at=now() where id=op.id;
 return true;
end $$;

commit;
