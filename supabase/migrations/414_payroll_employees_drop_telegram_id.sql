-- 414: contract-шаг к 412. Telegram ID разовых живёт в payroll_casual_contacts
-- (только сервер); колонка payroll_employees.telegram_id из 406 больше не
-- читается ни кодом, ни функциями базы (412 переписал их на новую таблицу).
-- Применяется после выкатки кода из #790.
begin;

do $$
begin
  if exists(select 1 from public.payroll_employees e
             where e.telegram_id is not null
               and not exists(select 1 from public.payroll_casual_contacts c where c.employee_id = e.id)) then
    raise exception '414: есть Telegram ID, не перенесённые в payroll_casual_contacts';
  end if;
end $$;

alter table public.payroll_employees drop constraint if exists payroll_employees_telegram_id_format;
alter table public.payroll_employees drop column if exists telegram_id;

notify pgrst, 'reload schema';
commit;
