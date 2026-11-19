begin;
-- «Сверка отметок»: решения управляющего по выходам попадают в журнал событий.
-- Решение по смене графика («засчитать» / «не учитывать» из расписания) уже
-- пишет журнал в payroll_review_schedule_shift (миграция 324). Здесь — два
-- оставшихся пути payroll_command: проверка отметки Quick Resto
-- (action 'attendance') и подтверждение невыхода (action 'missing_shift').
-- Фоновая сверка работает без сессии пользователя (auth.uid() is null) и
-- только переносит уже принятое решение — её в журнал не пишем.

create function private.payroll_attendance_review_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); employee_name text;
begin
 if actor is null or new.reviewed_by is null then return new; end if;
 if (old.status, old.reviewed_by, old.review_reason) is not distinct from (new.status, new.reviewed_by, new.review_reason)
  then return new; end if;
 select e.name into employee_name from public.payroll_employees e where e.id = new.employee_id;
 insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
 values (new.account_id, new.venue_id, actor, 'payroll.attendance.reviewed', 'payroll_attendance', new.id,
  jsonb_build_object('employee_id', new.employee_id, 'employee_name', employee_name,
   'business_date', new.business_date, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
   'before_status', old.status, 'status', new.status, 'reason', new.review_reason));
 return new;
end $$;
revoke all on function private.payroll_attendance_review_audit() from public, anon, authenticated;
create trigger payroll_attendance_review_audit after update of status, reviewed_by, review_reason on public.payroll_attendance
 for each row execute function private.payroll_attendance_review_audit();

-- Невыход подтверждается записью без decision; решения из расписания
-- (decision = include/exclude) журналирует сама функция проверки смены.
create function private.payroll_missing_shift_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); employee_name text;
begin
 if actor is null or new.decision is not null then return new; end if;
 select e.name into employee_name from public.payroll_employees e where e.id = new.employee_id;
 insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
 values (new.account_id, new.venue_id, actor, 'payroll.missing_shift.reviewed', 'payroll_schedule_review', new.id,
  jsonb_build_object('employee_id', new.employee_id, 'employee_name', employee_name, 'shift_id', new.shift_id,
   'business_date', new.business_date, 'starts_at', new.snapshot->>'starts_at', 'ends_at', new.snapshot->>'ends_at',
   'reason', new.reason));
 return new;
end $$;
revoke all on function private.payroll_missing_shift_audit() from public, anon, authenticated;
create trigger payroll_missing_shift_audit after insert or update on public.payroll_schedule_reviews
 for each row execute function private.payroll_missing_shift_audit();

-- Как и остальные записи зарплаты: общий журнал без права просмотра зарплаты
-- их не показывает (для 'payroll_schedule_review' политика есть с миграции 324).
create policy payroll_attendance_review_audit_access on public.audit_logs as restrictive for select to authenticated
 using (entity_type <> 'payroll_attendance' or (
  account_id = (select public.get_active_account_id())
  and venue_id = (select public.get_active_venue_id())
  and (select public.has_permission('payroll.view'))
 ));

notify pgrst, 'reload schema';
commit;
