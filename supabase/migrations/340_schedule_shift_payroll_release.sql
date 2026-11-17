-- Смену, уже засчитанную в зарплату, можно удалить или изменить, пока
-- зарплата за неё не выплачена и месяц не закрыт.
--
-- Раньше shift.delete отказывал («Смена уже учтена в зарплате. Оформите
-- корректировку начисления»), хотя засчитанный по графику выход — это
-- просто расчёт, который пересобирается из кассы и графика. Теперь:
--   • выплачено или месяц закрыт → отказ с понятной причиной (исправлять
--     корректировкой, деньги уже ушли);
--   • иначе при удалении выход по графику (external_id < 0) помечается
--     «не учитывается», связь выходов со сменой снимается, решения
--     «засчитать/не засчитывать» по смене удаляются.
-- Пересчёт дня после изменения прошедшей смены уже делает существующий
-- триггер schedule_queue_payroll — здесь его не дублируем.
-- Сделано триггерами: сотрудника и время меняют несколько путей (форма,
-- перенос мышью, замена, обновление по шаблону).
begin;

-- Зарплата по смене уже выплачена (есть проведённая выплата по начислению
-- этого сотрудника за день) или месяц закрыт.
create or replace function private.schedule_shift_payroll_locked(p_shift uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.payroll_attendance a
    join public.payroll_accruals ac
      on ac.venue_id = a.venue_id and ac.employee_id = a.employee_id and ac.business_date = a.business_date
    join public.payroll_payment_accruals pa on pa.accrual_id = ac.id
    join public.payroll_payments p on p.id = pa.payment_id and p.state = 'posted'
    where a.shift_id = p_shift
  ) or exists (
    select 1
    from public.payroll_attendance a
    join public.payroll_periods pp
      on pp.venue_id = a.venue_id and pp.month = date_trunc('month', a.business_date)::date and pp.status = 'closed'
    where a.shift_id = p_shift
  )
$$;
revoke all on function private.schedule_shift_payroll_locked(uuid) from public, anon, authenticated;

create or replace function private.schedule_shift_release_payroll()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  shift public.schedule_shifts := case when tg_op = 'DELETE' then old else new end;
begin
  if not exists (select 1 from public.payroll_attendance where shift_id = old.id) then
    return shift;
  end if;
  if private.schedule_shift_payroll_locked(old.id) then
    raise exception 'Зарплата за эту смену уже выплачена или месяц закрыт. Исправьте начисление корректировкой в зарплате';
  end if;

  if tg_op = 'DELETE' then
    update public.payroll_attendance
       set status = case when external_id < 0 then 'ignored' else status end,
           issue = case when external_id < 0 then 'Смена удалена из графика' else issue end,
           shift_id = null,
           version = version + 1
     where shift_id = old.id;
    delete from public.payroll_schedule_reviews where shift_id = old.id;
  end if;
  return shift;
end
$$;
revoke all on function private.schedule_shift_release_payroll() from public, anon, authenticated;

drop trigger if exists schedule_shift_release_payroll_delete on public.schedule_shifts;
create trigger schedule_shift_release_payroll_delete
  before delete on public.schedule_shifts
  for each row execute function private.schedule_shift_release_payroll();

drop trigger if exists schedule_shift_release_payroll_update on public.schedule_shifts;
create trigger schedule_shift_release_payroll_update
  after update on public.schedule_shifts
  for each row
  when (
    old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.user_id is distinct from new.user_id
    or old.payroll_employee_id is distinct from new.payroll_employee_id
    or old.payroll_model_id is distinct from new.payroll_model_id
    or old.role_id is distinct from new.role_id
    or old.published is distinct from new.published
  )
  execute function private.schedule_shift_release_payroll();

-- Убираем жёсткий запрет из shift.delete: решение теперь принимает триггер.
do $$
declare
  definition text := pg_get_functiondef('public.schedule_command(text,jsonb)'::regprocedure);
  old_check text := 'if exists(select 1 from public.payroll_attendance where shift_id=ident) then raise exception ''Смена уже учтена в зарплате. Оформите корректировку начисления'';end if;';
begin
  if strpos(definition, old_check) = 0 then
    raise exception 'Unexpected schedule_command: payroll delete check not found';
  end if;
  execute replace(definition, old_check, '');
end $$;

commit;
