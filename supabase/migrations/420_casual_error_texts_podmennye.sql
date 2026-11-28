-- «Разовых» сотрудников в интерфейсе теперь называем «подменными» (PR #807).
-- Здесь — те же слова в текстах ошибок, которые база отдаёт пользователю.
-- Меняется только текст: определение каждой функции берём из базы как есть
-- (pg_get_functiondef сохраняет security definer и search_path, OR REPLACE —
-- владельца и права) и заменяем в нём точные строки. Поведение не меняется.
-- Каждая строка должна найтись в своей функции, иначе миграция падает: тихо
-- пропущенная замена на проде оставила бы старый текст.
begin;

do $migration$
declare
  patch record;
  definition text;
begin
  for patch in
    select fn::regprocedure as fn, old_text, new_text from (values
      ('public.schedule_command(text,jsonb)',
       'Выберите штатного или разового сотрудника', 'Выберите штатного или подменного сотрудника'),
      ('public.schedule_command(text,jsonb)',
       'Проверьте имя разового сотрудника', 'Проверьте имя подменного сотрудника'),
      ('public.schedule_command(text,jsonb)',
       'Этот разовый сотрудник уже есть в списке', 'Этот подменный сотрудник уже есть в списке'),
      ('public.schedule_command(text,jsonb)',
       'Разовый сотрудник другого заведения или не найден', 'Подменный сотрудник другого заведения или не найден'),
      ('public.schedule_command(text,jsonb)',
       'У разового сотрудника нет доступа к чек-листам', 'У подменного сотрудника нет доступа к чек-листам'),
      ('public.payroll_set_attendance_source(uuid,text,date,text,uuid)',
       'Разовый выход уже учитывается по графику', 'Выход подменного сотрудника уже учитывается по графику'),
      ('public.payroll_casual_create(text,text,uuid)',
       'Этот разовый сотрудник уже есть в списке', 'Этот подменный сотрудник уже есть в списке'),
      ('public.payroll_casual_request_quickresto(uuid,text,text)',
       'Разовый сотрудник не найден', 'Подменный сотрудник не найден'),
      ('public.payroll_casual_request_quickresto(uuid,text,text)',
       'У разового не указана должность', 'У подменного не указана должность'),
      ('public.payroll_casual_request_quickresto(uuid,text,text)',
       'Этот разовый сотрудник уже есть в списке', 'Этот подменный сотрудник уже есть в списке'),
      ('public.payroll_casual_to_staff(uuid,uuid)',
       'Разовый сотрудник не найден', 'Подменный сотрудник не найден'),
      ('public.payroll_casual_set_telegram_id(uuid,text)',
       'Разовый сотрудник не найден', 'Подменный сотрудник не найден'),
      ('public.payroll_casual_dismiss(uuid,text,boolean)',
       'Разовый сотрудник не найден', 'Подменный сотрудник не найден'),
      ('public.payroll_casual_dismiss(uuid,text,boolean)',
       'повторите «Добавить → Разовый» с тем же именем', 'повторите «Добавить → Подменный» с тем же именем')
    ) as t(fn, old_text, new_text)
  loop
    definition := pg_get_functiondef(patch.fn);
    if position(patch.old_text in definition) = 0 then
      raise exception '420: в функции % нет текста «%»', patch.fn, patch.old_text;
    end if;
    execute replace(definition, patch.old_text, patch.new_text);
  end loop;
end $migration$;

-- Ни в одной функции public не осталось старых текстов ошибок.
do $$
declare
  leftover text;
begin
  select p.oid::regprocedure || ': ' || t.old_text into leftover
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values
      ('разового сотрудника'), ('Разовый сотрудник'), ('разовый сотрудник'),
      ('У разового не указана'), ('Разовый выход'), ('Добавить → Разовый')
    ) as t(old_text)
   where n.nspname = 'public' and position(t.old_text in p.prosrc) > 0
   limit 1;
  if leftover is not null then
    raise exception '420: остался старый текст — %', leftover;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
