-- Рабочий экран «Зарплаты» переехал с /payroll-concept на /people/payroll
-- (старый адрес остаётся перенаправлением в next.config.ts).
--
-- 1. payroll_journal_command пишет в уведомление о комментарии ссылку на
--    запись журнала. Функцию не переписываем вручную: берём её текущее
--    определение из базы и меняем только адрес. Так сохраняются все
--    атрибуты (security definer, search_path) и правки, если тело на проде
--    отличается от последнего файла миграции. CREATE OR REPLACE сохраняет
--    владельца и права.
-- 2. Уже созданные уведомления: ссылки переводим на новый адрес. Триггеров
--    на public.notifications нет, повторной рассылки не будет.
begin;

do $mig$
declare
  def text := pg_get_functiondef('public.payroll_journal_command(text,jsonb)'::regprocedure);
begin
  if position('/payroll-concept?' in def) > 0 then
    execute replace(def, '/payroll-concept?', '/people/payroll?');
  end if;
end
$mig$;

update public.notifications
set link = '/people/payroll' || substr(link, length('/payroll-concept') + 1)
where link like '/payroll-concept%';

notify pgrst, 'reload schema';

commit;
