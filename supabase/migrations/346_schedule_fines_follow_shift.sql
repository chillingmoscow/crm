-- Автоматические штрафы смены следуют за графиком.
--
-- 1. «Нет отметки» и «Опоздание» раньше только добавлялись (on conflict do
--    nothing): удалили ошибочную смену, поменяли её время или отдали смену
--    другому — штраф оставался прежним. Теперь при пересчёте дня:
--    • смены больше нет / снята с публикации / назначена другому → штраф
--      снимается системой;
--    • отметка Quick Resto появилась → «Нет отметки» снимается;
--    • опоздания по новому времени нет → снимается, иначе сумма
--      пересчитывается (если человек не правил запись руками);
--    • условие вернулось → снятый системой штраф восстанавливается.
--    Удалённые человеком записи, проведённые бонусные операции и закрытые
--    месяцы не трогаем.
-- 2. Смену с невыполненной задачей (без отчёта) теперь можно удалить —
--    штраф за задачу снимается вместе со сменой. Сама задача остаётся
--    невыполненной, её перенос на следующий день сохраняется.
-- 3. Обновление смен по шаблону больше не пропускает смены, по которым уже
--    посчитана явка: зарплата пересчитывается по графику. Выплаченные дни и
--    закрытые месяцы по-прежнему защищает триггер смены.
begin;

-- ---------------------------------------------------------------------------
-- Общие помощники
-- ---------------------------------------------------------------------------

-- Причина, с которой система снимает штраф. По ней же отличаем снятое
-- системой (можно восстановить) от удалённого человеком.
create or replace function private.payroll_shift_fine_released_reason()
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$ select 'Смена изменилась или удалена из графика'::text $$;

-- Запись можно менять автоматически: не проведена бонусом, не связана
-- с выплатой премии и не в обработке бонусной операции.
create or replace function private.payroll_adjustment_auto_mutable(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.payroll_adjustments a
    where a.id = p_id
      and not (a.medium = 'bonus' and a.external_state = 'done')
      and not exists (select 1 from public.payroll_payments p where p.bonus_adjustment_id = a.id and p.state = 'posted')
      and not exists (select 1 from public.payroll_bonus_operations o where o.adjustment_id = a.id and o.state in ('reading','sending','review'))
      and not exists (select 1 from public.payroll_periods q where q.venue_id = a.venue_id and q.month = date_trunc('month', a.business_date)::date and q.status <> 'draft')
  )
$$;

-- Человек правил запись (сумму или основание) — автоматика сумму не трогает.
-- Система запоминает, что записала сама (rule_snapshot.auto); для старых
-- записей без снимка — по шаблону основания и журналу правок.
create or replace function private.payroll_adjustment_touched(p_id uuid, p_amount numeric, p_reason text, p_snapshot jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when p_snapshot ? 'auto' then p_amount is distinct from (p_snapshot->'auto'->>'amount')::numeric
                               or p_reason is distinct from p_snapshot->'auto'->>'reason'
    else p_reason !~ '^Опоздание на [0-9]+ мин\.$'
      or exists (select 1 from public.payroll_adjustment_history h
                 where h.adjustment_id = p_id and h.action = 'updated' and h.actor_id is not null)
  end
$$;

-- ---------------------------------------------------------------------------
-- 1. Дисциплина: пересчёт вместо «только добавить»
-- ---------------------------------------------------------------------------
create or replace function private.payroll_generate_discipline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  s public.payroll_discipline_settings; r record; x public.payroll_adjustments; sh public.schedule_shifts;
  entry_kind text; entry_medium text; entry_amount numeric; entry_reason text; entry_key text;
  late_minutes integer; previous integer; tz text; day_hour integer;
  released text := private.payroll_shift_fine_released_reason();
  -- Ключи, для которых по текущему графику штраф положен / точно не положен.
  wanted text[] := '{}'; cleared text[] := '{}';
begin
 if exists(select 1 from public.payroll_settings where account_id=new.account_id and venue_id=new.venue_id and new.business_date<=historical_through) then return new;end if;
 if new.state<>'complete' then return new;end if;
 select * into s from public.payroll_discipline_settings where venue_id=new.venue_id and account_id=new.account_id;
 if not s.enabled or s.venue_id is null or new.business_date<s.valid_from or new.business_date>=(now() at time zone (select timezone from public.venues where id=new.venue_id))::date then return new;end if;
 if exists(select 1 from public.payroll_periods where venue_id=new.venue_id and month=date_trunc('month',new.business_date)::date and status<>'draft') then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
 select timezone into tz from public.venues where id=new.venue_id;
 select day_start_hour into day_hour from public.sales_settings where venue_id=new.venue_id;
 if tz is null or day_hour is null then return new;end if;
 for r in
 select e.id employee_id,e.casual casual,p.id shift_id,p.starts_at,p.ends_at,actual.starts_at actual_start,actual.ends_at actual_end,actual.id attendance_id,actual.status,
 (select count(*) from public.schedule_shifts other where other.venue_id=p.venue_id and (other.user_id=p.user_id or other.payroll_employee_id=p.payroll_employee_id) and other.published and other.starts_at<actual.ends_at and other.ends_at>actual.starts_at) matches
 from public.schedule_shifts p join public.payroll_employees e on e.venue_id=p.venue_id and e.active and (e.local_user_id=p.user_id or (e.casual and e.quickresto_id is not null and p.payroll_employee_id=e.id))
 left join lateral(select t.* from public.payroll_attendance t where t.venue_id=p.venue_id and t.employee_id=e.id and t.business_date=new.business_date and t.shift_id=p.id and t.status<>'ignored' and (t.external_id>0 or p.starts_at<s.missing_mark_strict_from) order by t.starts_at limit 1) actual on true
 where private.payroll_attendance_source(e.id,new.business_date)='quickresto' and p.venue_id=new.venue_id and p.published and (p.user_id is not null or p.payroll_employee_id is not null) and p.ends_at<now() and ((p.starts_at at time zone tz)-make_interval(hours=>day_hour))::date=new.business_date
 loop
  entry_kind:=null;entry_medium:='money';entry_amount:=0;entry_key:=r.shift_id||':attendance';
  if r.attendance_id is not null then cleared:=cleared||entry_key;end if;
  if r.attendance_id is null and s.missing_enabled and not r.casual and not exists(select 1 from public.payroll_attendance t where t.venue_id=new.venue_id and t.employee_id=r.employee_id and t.business_date=new.business_date and (t.external_id>0 or r.starts_at<s.missing_mark_strict_from)) and not exists(select 1 from public.payroll_schedule_reviews rv where rv.shift_id=r.shift_id and rv.employee_id=r.employee_id and rv.decision='include') then
   wanted:=wanted||entry_key;
   select * into x from public.payroll_adjustments where venue_id=new.venue_id and automation_key=entry_key;
   if x.id is null then
    select count(*) into previous from public.payroll_adjustments where venue_id=new.venue_id and employee_id=r.employee_id and origin='missing_clockin' and deleted_at is null and business_date>=date_trunc('month',new.business_date)::date and business_date<date_trunc('month',new.business_date)::date+interval '1 month';
    entry_kind:=case when previous=0 then 'warning' else 'deduction' end;entry_medium:=case when previous=0 then 'none' else 'money' end;entry_amount:=case when previous=0 then 0 else -s.missing_amount end;entry_reason:='Нет отметки о смене Quick Resto';
    insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,automation_key)
    values(new.account_id,new.venue_id,r.employee_id,new.business_date,entry_kind,entry_medium,entry_amount,entry_reason,true,true,'missing_clockin',entry_key) on conflict(venue_id,automation_key) where automation_key is not null do nothing;
   elsif x.deleted_at is not null and x.deleted_by is null and x.delete_reason=released and x.employee_id=r.employee_id then
    update public.payroll_adjustments set deleted_at=null,delete_reason=null where id=x.id;
   end if;
  elsif r.actual_end is not null and r.matches=1 and s.late_enabled and r.status not in ('unlinked','open','missing') then
   entry_key:=r.shift_id||':lateness';
   late_minutes:=round(extract(epoch from (r.actual_start-r.starts_at))/60);
   if late_minutes>0 then
    wanted:=wanted||entry_key;
    entry_kind:=case when late_minutes<=s.late_grace then 'warning' else 'deduction' end;
    entry_medium:=case when entry_kind='warning' then 'none' when s.late_bonus then 'bonus' else 'money' end;
    entry_amount:=case when entry_kind='warning' then 0 else -least(ceil(late_minutes::numeric/s.late_step)*s.late_amount,s.late_max) end;
    entry_reason:='Опоздание на '||late_minutes||' мин.';
    select * into x from public.payroll_adjustments where venue_id=new.venue_id and automation_key=entry_key;
    if x.id is null then
     insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,automation_key,external_state,rule_snapshot)
     values(new.account_id,new.venue_id,r.employee_id,new.business_date,entry_kind,entry_medium,entry_amount,entry_reason,true,true,'lateness',entry_key,case when entry_medium='bonus' then 'review' else 'not_required' end,
            jsonb_build_object('auto',jsonb_build_object('amount',entry_amount,'reason',entry_reason))) on conflict(venue_id,automation_key) where automation_key is not null do nothing;
    elsif x.employee_id=r.employee_id and (x.deleted_at is null or (x.deleted_by is null and x.delete_reason=released))
      and private.payroll_adjustment_auto_mutable(x.id) then
     if x.reason<>entry_reason and not private.payroll_adjustment_touched(x.id,x.amount,x.reason,x.rule_snapshot) then
      -- Минуты опоздания изменились (поменяли время смены) — пересчитываем.
      -- При тех же минутах сумму не трогаем: иначе смена ставок переписала
      -- бы прошлые штрафы.
      update public.payroll_adjustments
         set deleted_at=null,delete_reason=null,kind=entry_kind,reason=entry_reason,amount=entry_amount,
             rule_snapshot=x.rule_snapshot||jsonb_build_object('auto',jsonb_build_object('amount',entry_amount,'reason',entry_reason)),
             -- Способ списания (бонусы/деньги после сверки баланса) сохраняем;
             -- меняем только при переходе предупреждение ↔ штраф.
             medium=case when entry_kind='warning' then 'none' when x.kind='warning' then entry_medium else x.medium end,
             external_state=case
               when entry_kind='warning' then 'not_required'
               when x.kind='warning' then case when entry_medium='bonus' then 'review' else 'not_required' end
               else x.external_state end
       where id=x.id;
     elsif x.deleted_at is not null then
      update public.payroll_adjustments set deleted_at=null,delete_reason=null where id=x.id;
     end if;
    end if;
   else
    cleared:=cleared||entry_key;
   end if;
  end if;
  if r.attendance_id is not null and s.unclosed_enabled and (r.actual_end is null or r.actual_end-r.actual_start>interval '24 hours') and r.actual_start<now()-interval '24 hours' then
   insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,managed,origin,automation_key)
   values(new.account_id,new.venue_id,r.employee_id,new.business_date,'deduction',-s.unclosed_amount,'Не закрыта персональная смена',true,true,'unclosed_shift',r.attendance_id||':unclosed') on conflict(venue_id,automation_key) where automation_key is not null do nothing;
  end if;
 end loop;

 -- Штрафы дня, которые больше не положены по графику.
 for x in
  select a.* from public.payroll_adjustments a
  where a.venue_id=new.venue_id and a.business_date=new.business_date and a.deleted_at is null and a.managed
    and a.origin in ('missing_clockin','lateness') and a.automation_key ~ '^[0-9a-f-]{36}:(attendance|lateness)$'
    and not (a.automation_key = any(wanted))
  for update
 loop
  select * into sh from public.schedule_shifts where id=split_part(x.automation_key,':',1)::uuid;
  if not (
       x.automation_key = any(cleared)
       -- Смену удалили, сняли с публикации, перенесли на другой день или отдали другому.
       or sh.id is null or not sh.published
       or ((sh.starts_at at time zone tz)-make_interval(hours=>day_hour))::date is distinct from x.business_date
       or not exists(select 1 from public.payroll_employees e where e.id=x.employee_id and (e.local_user_id=sh.user_id or (e.casual and sh.payroll_employee_id=e.id)))
     ) then continue; end if;
  if not private.payroll_adjustment_auto_mutable(x.id) then continue; end if;
  update public.payroll_adjustments set deleted_at=now(),deleted_by=null,delete_reason=released where id=x.id;
 end loop;
 return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 2. Удаление смены с невыполненной задачей
-- ---------------------------------------------------------------------------
create or replace function private.schedule_task_shift_report_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare o public.schedule_task_occurrences;tz text;
begin
 if tg_op='UPDATE' then
  select coalesce(timezone,'Europe/Moscow') into tz from public.venues where id=old.venue_id;
  if new.user_id is not distinct from old.user_id and new.payroll_employee_id is not distinct from old.payroll_employee_id
   and new.template_id is not distinct from old.template_id and (new.starts_at at time zone tz)::date=(old.starts_at at time zone tz)::date then return new;end if;
 end if;
 for o in select * from public.schedule_task_occurrences where shift_id=old.id for update loop
  -- Отчёта нет, задача просто не выполнена: смену удалить можно, штраф
  -- за задачу снимается вместе с ней.
  if tg_op='DELETE' and o.status='missed' and o.answers='{}'::jsonb and o.submitted_at is null and not o.evidence_started then
   if o.adjustment_id is not null and private.payroll_adjustment_auto_mutable(o.adjustment_id) then
    update public.payroll_adjustments set deleted_at=now(),deleted_by=null,delete_reason='Смена удалена из графика'
     where id=o.adjustment_id and deleted_at is null and origin='task';
   end if;
   insert into public.schedule_task_history(venue_id,entity_id,action,details)
   values(o.venue_id,o.id,'shift.deleted',jsonb_build_object('shift_id',old.id,'adjustment_id',o.adjustment_id));
   continue;
  end if;
  if o.status not in ('blocked','assigned') or o.answers<>'{}'::jsonb or o.submitted_at is not null or o.settled_at is not null
   or o.evidence_started then
   if tg_op='DELETE' then raise exception 'Нельзя удалить смену с начатым отчётом задачи';end if;
   raise exception 'Нельзя менять назначение смены с начатым отчётом задачи';
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;
 return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Обновление смен по шаблону — без пропуска «учтённых в зарплате»
-- ---------------------------------------------------------------------------
do $$
declare def text := pg_get_functiondef('public.schedule_apply_template(uuid,date,text)'::regprocedure);
  old_block text := $b$    if exists (select 1 from public.payroll_attendance a where a.shift_id = shift.id) then
      skipped := skipped || jsonb_build_object('date', shift_day, 'reason', 'Смена уже учтена в зарплате');
      continue;
    end if;

$b$;
begin
  if position(old_block in def) > 0 then
    execute replace(def, old_block, '');
  elsif position('payroll_attendance' in def) > 0 then
    raise exception 'schedule_apply_template: блок проверки зарплаты не найден';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
