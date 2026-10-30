begin;
-- Forward fixes from PR review: honor local cutover dates, keep unsent work editable, retain reminder catch-up.
create or replace function public.payroll_prepare_bonus_operations() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.payroll_bonus_operations o set state='review',message='Режим работы изменён. Подтвердите обработку этой прежней операции отдельно.' from public.payroll_execution_policy p where p.venue_id=o.venue_id and o.policy_version<>p.version and o.state='pending';
 insert into public.payroll_bonus_operations(account_id,venue_id,employee_id,adjustment_id,operation,guest_id,bonus_account_id,direction,amount,policy_version)
 select r.account_id,r.venue_id,r.employee_id,r.id,'apply',e.quickresto_guest_id,e.quickresto_bonus_account_id,case when r.amount>0 then 'credit' else 'debit' end,abs(r.amount),p.version
 from public.payroll_adjustments r join public.payroll_employees e on e.id=r.employee_id and e.venue_id=r.venue_id and e.account_id=r.account_id
 join public.payroll_execution_policy p on p.venue_id=r.venue_id and p.account_id=r.account_id
 join public.venues v on v.id=r.venue_id
 where p.legacy_stopped and p.bonus_from<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and r.business_date<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and r.business_date>=p.bonus_from and r.created_at>=p.activated_at
 and r.origin in ('lateness','manual') and r.medium='bonus' and r.kind in ('deduction','bonus') and r.approved and r.deleted_at is null
 and r.external_state in ('review','pending') and e.quickresto_guest_id>0 and e.quickresto_bonus_account_id>0
 on conflict(adjustment_id,operation) do update set employee_id=excluded.employee_id,guest_id=excluded.guest_id,bonus_account_id=excluded.bonus_account_id,direction=excluded.direction,amount=excluded.amount,policy_version=excluded.policy_version,state='pending',lease_token=null,claimed_at=null,finished_at=null,message='Восстановлена ещё не отправленная запись'
 where payroll_bonus_operations.state='cancelled' and payroll_bonus_operations.before_balance is null and payroll_bonus_operations.provider_reference is null;
 get diagnostics n=row_count;return n;
end $$;

create or replace function public.payroll_claim_bonus_operation() returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;token uuid:=gen_random_uuid();
begin
 -- A process may have died after a POST. Such work must never be retried automatically.
 update public.payroll_bonus_operations set state='review',message='Ответ Quick Resto не подтверждён. Нужна сверка операции без повторного списания.' where state='sending' and claimed_at<now()-interval '3 minutes';
 select o.* into op from public.payroll_bonus_operations o join public.payroll_execution_policy p on p.venue_id=o.venue_id
 join public.venues v on v.id=o.venue_id
 join public.payroll_adjustments r on r.id=o.adjustment_id
 where p.legacy_stopped and p.bonus_from<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and r.business_date<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date and o.policy_version=p.version and (o.state='pending' or (o.state='reading' and o.claimed_at<now()-interval '3 minutes'))
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

create or replace function public.payroll_review_bonus_operation(p_id uuid,p_executed boolean,p_evidence text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;op public.payroll_bonus_operations;r public.payroll_adjustments;e public.payroll_employees;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into op from public.payroll_bonus_operations where id=p_id and account_id=a and venue_id=v for update;
 if op.id is null or op.state<>'review' then raise exception 'Операция уже проверена или недоступна';end if;
 if p_executed is null or length(trim(coalesce(p_evidence,''))) not between 3 and 1000 then raise exception 'Укажите подтверждение из истории Quick Resto';end if;
 if p_executed then
  update public.payroll_bonus_operations set state='done',provider_reference=trim(p_evidence),message='Подтверждено по истории Quick Resto',finished_at=now() where id=op.id;
  if op.operation='apply' then
   update public.payroll_adjustments set external_state='done',external_ref='sheerly-bonus:'||op.id where id=op.adjustment_id;
  else
   update public.payroll_adjustments set external_state='not_required',deleted_at=now(),deleted_by=u,delete_reason='Отменено после подтверждения обратной бонусной операции' where id=op.adjustment_id;
  end if;
 else
  -- Explicitly reviewed absence authorizes a new attempt. It is not a timeout retry.
  select * into r from public.payroll_adjustments where id=op.adjustment_id;
  select * into e from public.payroll_employees where id=r.employee_id;
  if r.deleted_at is not null or r.medium<>'bonus' then
   update public.payroll_bonus_operations set state='cancelled',message='Подтверждено отсутствие операции; запись отменена',finished_at=now() where id=op.id;
  elsif op.operation='apply' and (e.quickresto_guest_id is null or e.quickresto_bonus_account_id is null) then
   raise exception 'Сначала укажите бонусный счёт сотрудника';
  else
  update public.payroll_bonus_operations set employee_id=r.employee_id,
   amount=case when op.operation='apply' then abs(r.amount) else op.amount end,
   direction=case when op.operation='apply' then case when r.amount>0 then 'credit' else 'debit' end else op.direction end,
   guest_id=case when op.operation='apply' then e.quickresto_guest_id else op.guest_id end,
   bonus_account_id=case when op.operation='apply' then e.quickresto_bonus_account_id else op.bonus_account_id end,
   state='pending',policy_version=(select version from public.payroll_execution_policy where venue_id=v),lease_token=null,claimed_at=null,before_balance=null,after_balance=null,provider_reference=trim(p_evidence),message='Отсутствие операции проверено. Разрешена новая попытка',finished_at=null where id=op.id;
  end if;
 end if;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.bonus_operation.reviewed','payroll_bonus_operation',op.id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=op.employee_id),'executed',p_executed,'evidence',trim(p_evidence)));
end $$;

create or replace function private.payroll_guard_bonus_operation() returns trigger language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;e public.payroll_employees;
begin
 if (new.amount,new.medium,new.deleted_at,new.employee_id,new.business_date) is not distinct from (old.amount,old.medium,old.deleted_at,old.employee_id,old.business_date) then return new;end if;
 if exists(select 1 from public.payroll_bonus_operations where adjustment_id=old.id and state in ('reading','sending','review')) then raise exception 'Бонусная операция обрабатывается или требует сверки. Сначала проверьте её результат';end if;
 for op in select * from public.payroll_bonus_operations where adjustment_id=old.id and state='pending' for update nowait loop
  if op.operation='reverse' then raise exception 'Дождитесь обратной бонусной операции';end if;
  select * into e from public.payroll_employees where id=new.employee_id and account_id=new.account_id and venue_id=new.venue_id;
  if new.deleted_at is not null or new.medium<>'bonus' or new.amount=0 or e.quickresto_guest_id is null or e.quickresto_bonus_account_id is null then
   update public.payroll_bonus_operations set state='cancelled',message='Ещё не отправленная запись изменена или удалена',finished_at=now() where id=op.id;
  else
   update public.payroll_bonus_operations set employee_id=new.employee_id,amount=abs(new.amount),direction=case when new.amount>0 then 'credit' else 'debit' end,guest_id=e.quickresto_guest_id,bonus_account_id=e.quickresto_bonus_account_id,message='Очередь обновлена после изменения записи' where id=op.id;
  end if;
 end loop;
 if exists(select 1 from public.payroll_bonus_operations where adjustment_id=old.id and state in ('reading','sending','review')) then raise exception 'Бонусная операция обрабатывается или требует сверки. Сначала проверьте её результат';end if;
 return new;
exception when lock_not_available then raise exception 'Бонусная операция обрабатывается. Повторите изменение позже';
end $$;

create or replace function public.enqueue_medical_book_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  r record;
  v_days_left integer;
  v_title text;
  v_body  text;
begin
  for r in
    update public.staff_account_details sad
       set medical_book_expiry_notified_for = sad.medical_book_date
     where sad.medical_book_date is not null
       -- Retain catch-up for edits made after payroll's exact reminder date.
       -- A payroll reminder sets the same notified_for marker atomically.
       and not exists (
         select 1 from public.payroll_employees e join public.payroll_execution_policy p on p.venue_id=e.venue_id
         join public.payroll_automation_settings cfg on cfg.venue_id=e.venue_id join public.venues v on v.id=e.venue_id
         where e.local_user_id=sad.user_id and e.account_id=sad.account_id and e.active and p.legacy_stopped
         and p.salary_from<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date
         and (not (cfg.config->'medical'->>'reminders')::boolean
              or sad.medical_book_date>(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date+(cfg.config->'medical'->>'reminder_before_expiry_days')::integer)
       )
       and sad.medical_book_date <= current_date + interval '30 days'
       and (
         sad.medical_book_expiry_notified_for is null
         or sad.medical_book_expiry_notified_for <> sad.medical_book_date
       )
       and exists (
         select 1
         from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id  = sad.user_id
           and uvr.status   = 'active'
           and v.account_id = sad.account_id
       )
     returning sad.account_id, sad.user_id, sad.medical_book_date
  loop
    v_days_left := (r.medical_book_date - current_date)::integer;
    if v_days_left < 0 then
      v_title := 'Медкнижка просрочена';
      v_body  := 'Срок действия медкнижки истёк ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 '. Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    elsif v_days_left = 0 then
      v_title := 'Сегодня истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается сегодня. ' ||
                 'Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    else
      v_title := 'Скоро истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 ' (через ' || v_days_left || ' дн.). ' ||
                 'Запишитесь на анализы заранее, чтобы не было перерыва в работе.';
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      r.user_id,
      'staff.medical_book_expiring',
      v_title,
      v_body,
      '/profile'
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.payroll_reverse_bonus(p_adjustment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;op public.payroll_bonus_operations;result uuid;
begin
 select s.a,s.v into a,v from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into op from public.payroll_bonus_operations where adjustment_id=p_adjustment and account_id=a and venue_id=v and operation='apply' and state='done';
 if op.id is null then raise exception 'Подтверждённая бонусная операция Sheerly не найдена';end if;
 if not exists(select 1 from public.payroll_execution_policy where venue_id=v and legacy_stopped and bonus_from is not null) then raise exception 'Сейчас включён режим сравнения';end if;
 insert into public.payroll_bonus_operations(account_id,venue_id,employee_id,adjustment_id,operation,reverses_id,guest_id,bonus_account_id,direction,amount,policy_version)
 values(a,v,op.employee_id,op.adjustment_id,'reverse',op.id,op.guest_id,op.bonus_account_id,case when op.direction='debit' then 'credit' else 'debit' end,op.amount,(select version from public.payroll_execution_policy where venue_id=v))
 on conflict(adjustment_id,operation) do update set adjustment_id=excluded.adjustment_id returning id into result;
 return result;
end $$;
notify pgrst,'reload schema';
commit;
