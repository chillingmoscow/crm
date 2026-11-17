-- Модель оплаты разового в графике подбирается по тому же правилу, что и
-- расчёт зарплаты (shiftPayModelId): по должности (role_id) и модели
-- должности по умолчанию (is_role_default), а не по role_name — это группа
-- команды для подсчёта людей («Старший бармен» и «Бармен» в одной группе,
-- но это разные должности со своими моделями).
-- Добавляем role_id и is_role_default моделей и дату правила
-- «в своём подразделении — своя ставка».
begin;

create or replace function public.schedule_payroll_options()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
 select case when public.has_permission('schedule.view_all') then jsonb_build_object(
  'employees', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.name, 'role_id', e.role_id, 'role_name', e.role_name, 'model_id', e.model_id)), '[]')
    from public.payroll_employees e where e.venue_id = public.get_active_venue_id() and e.casual),
  'models', case when public.has_permission('payroll.configure') then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'role_name', m.role_name, 'role_id', m.role_id, 'is_role_default', m.is_role_default)), '[]')
    from public.payroll_models m
    where m.venue_id = public.get_active_venue_id() and not m.archived and m.monthly_amount = 0) else '[]'::jsonb end,
  'same_department_rate_from', case when public.has_permission('payroll.configure') then (
    select s.same_department_rate_from from public.payroll_settings s
    where s.venue_id = public.get_active_venue_id()) end
 ) else '{"employees":[],"models":[]}'::jsonb end;
$$;
revoke all on function public.schedule_payroll_options() from public, anon;
grant execute on function public.schedule_payroll_options() to authenticated;

commit;
