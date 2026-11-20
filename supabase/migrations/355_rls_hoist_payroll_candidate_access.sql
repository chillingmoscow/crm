-- «Зарплата» и «Кандидаты» открывались по нескольку секунд при сотнях строк.
-- Причина — политики чтения: private.payroll_read(...) и
-- private.candidate_access(...) получают столбцы строки аргументами, поэтому
-- Postgres не может вынести их в InitPlan и вызывает для КАЖДОЙ строки.
-- Внутри каждого вызова — get_active_account_id(), get_active_venue_id() и
-- has_permission(): три запроса к profiles/venues/user_venue_roles/role_permissions.
--
-- Замер на проде (владелец, 19.11.2026, explain analyze):
--   payroll_accruals, 918 строк ......... 973–1488 мс
--   payroll_payments, 155 строк ......... 137 мс
--   candidates, 69 строк ................ 186–202 мс
--   notifications (колокольчик на любой странице), 64 строки ... 305 мс:
--     ограничивающая политика для уведомлений о кандидатах вызывает
--     candidate_access для каждого кандидата.
-- Тот же предикат, где контекст вычисляется один раз:
--   payroll_accruals 6 мс, candidates 3 мс.
--
-- Решение: сравнивать столбцы строки с контекстом, вычисленным один раз
-- на запрос — (select public.get_active_account_id()) и т. п. Права
-- не меняются, меняется только то, сколько раз они вычисляются.
--   * payroll_read(a, v, e) ≡ a = активный аккаунт AND v = активное заведение
--     AND (payroll.view OR e ∈ «мои карточки сотрудника в этом заведении»).
--     Второе — новая private.payroll_own_employee_ids(): массив id, тоже
--     вычисляется один раз (раньше — exists на каждую строку).
--   * candidate_access(a, false) ≡ uid есть AND a = активный аккаунт
--     AND people.manage_candidates.
-- Политики записи (candidate_update, команды) не трогаются: они проверяют
-- одну строку. Функции payroll_read/candidate_access остаются — их зовут
-- политики storage и RPC.

-- Свои карточки сотрудника в активном заведении: то же условие, что
-- последний exists в private.payroll_read, но без привязки к строке.
create or replace function private.payroll_own_employee_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(array_agg(employee.id), '{}'::uuid[])
  from public.payroll_employees employee
  join public.user_venue_roles membership
    on membership.user_id = employee.local_user_id
   and membership.venue_id = employee.venue_id
  where employee.local_user_id = (select auth.uid())
    and employee.account_id = public.get_active_account_id()
    and employee.venue_id = public.get_active_venue_id()
    and membership.status = 'active'
    and membership.fired_at is null
$$;
revoke all on function private.payroll_own_employee_ids() from public, anon;
grant execute on function private.payroll_own_employee_ids() to authenticated, service_role;

-- 1. Политики чтения на private.payroll_read.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- таблицы, где сотрудник видит свои строки
      ('payroll_accruals',                'payroll_read',                    'employee_id'),
      ('payroll_adjustment_comments',     'payroll_read',                    'employee_id'),
      ('payroll_adjustment_history',      'payroll_read',                    'employee_id'),
      ('payroll_adjustment_photos',       'payroll_read',                    'employee_id'),
      ('payroll_adjustments',             'payroll_read',                    'employee_id'),
      ('payroll_allocations',             'payroll_read',                    'employee_id'),
      ('payroll_attendance',              'payroll_read',                    'employee_id'),
      ('payroll_attendance_rules',        'payroll_attendance_rule_read',    'employee_id'),
      ('payroll_employee_models',         'payroll_employee_models_read',    'employee_id'),
      ('payroll_employees',               'payroll_read',                    'id'),
      ('payroll_events',                  'payroll_read',                    'employee_id'),
      ('payroll_legacy_payments',         'payroll_legacy_read',             'employee_id'),
      ('payroll_payment_accruals',        'payroll_payment_accruals_read',   'employee_id'),
      ('payroll_qualifications',          'payroll_qualifications_read',     'employee_id'),
      ('payroll_schedule_reviews',        'payroll_schedule_reviews_read',   'employee_id'),
      ('payroll_transfers',               'payroll_transfer_read',           'employee_id'),
      -- только payroll.view
      ('payroll_adesk_sync',              'payroll_adesk_sync_read',         null),
      ('payroll_adjustment_notifications','payroll_adjustment_notifications_read', null),
      ('payroll_cashbox',                 'payroll_read',                    null),
      ('payroll_discipline_settings',     'payroll_discipline_read',         null),
      ('payroll_models',                  'payroll_read',                    null),
      ('payroll_payments',                'payroll_read',                    null),
      ('payroll_periods',                 'payroll_read',                    null),
      ('payroll_rule_versions',           'payroll_read',                    null),
      ('payroll_settings',                'payroll_read',                    null)
    ) as v(tbl, pol, employee_col)
  loop
    execute format(
      'alter policy %I on public.%I using ('
      ' account_id = (select public.get_active_account_id())'
      ' and venue_id = (select public.get_active_venue_id())'
      ' and ((select public.has_permission(''payroll.view''))%s))',
      r.pol, r.tbl,
      case when r.employee_col is null then ''
        else format(' or %I = any ((select private.payroll_own_employee_ids())::uuid[])', r.employee_col)
      end);
  end loop;
end $$;

-- 2. Настройки автоматизации и исполнения — payroll.configure; те же вызовы,
--    только обёрнутые в (select ...).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('payroll_automation_effects',          'automation_configure_read'),
      ('payroll_automation_jobs',             'payroll_automation_job_read'),
      ('payroll_automation_people',           'automation_configure_read'),
      ('payroll_automation_runs',             'automation_configure_read'),
      ('payroll_automation_settings',         'payroll_automation_read'),
      ('payroll_automation_settings_history', 'payroll_automation_history_read'),
      ('payroll_bonus_operations',            'payroll_execution_read'),
      ('payroll_execution_policy',            'payroll_execution_read'),
      ('payroll_uniform_issues',              'automation_configure_read')
    ) as v(tbl, pol)
  loop
    execute format(
      'alter policy %I on public.%I using ('
      ' account_id = (select public.get_active_account_id())'
      ' and venue_id = (select public.get_active_venue_id())'
      ' and (select public.has_permission(''payroll.configure'')))',
      r.pol, r.tbl);
  end loop;
end $$;

alter policy payroll_automation_import_events_read on public.payroll_events using (
  action = 'automation_source_imported'
  and account_id = (select public.get_active_account_id())
  and venue_id = (select public.get_active_venue_id())
  and (select public.has_permission('payroll.configure'))
);
alter policy payroll_automation_import_event_access on public.payroll_events using (
  action <> 'automation_source_imported'
  or (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('payroll.configure'))
  )
);

-- 3. Ограничивающие политики журнала (audit_logs) для зарплатных записей.
alter policy payroll_attendance_audit_access on public.audit_logs using (
  entity_type <> 'payroll_attendance_rule'
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure')))
);
alter policy payroll_audit_salary_access on public.audit_logs using (
  entity_type <> all (array['payroll_adjustment', 'payroll_transfer', 'payroll_import'])
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.view')))
);
alter policy payroll_automation_audit_access on public.audit_logs using (
  entity_type <> 'payroll_automation_settings'
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure')))
);
alter policy payroll_automation_state_audit_access on public.audit_logs using (
  entity_type <> all (array['payroll_automation_person', 'payroll_uniform', 'payroll_automation_run'])
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure')))
);
alter policy payroll_execution_audit_access on public.audit_logs using (
  entity_type <> all (array['payroll_execution', 'payroll_bonus_operation'])
  or (account_id = (select public.get_active_account_id())
      and venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure')))
);
alter policy payroll_rule_audit_access on public.audit_logs using (
  entity_type <> all (array['payroll_rule', 'payroll_position'])
  or (venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure')))
);

-- 4. Кандидаты: candidate_access(account_id, false) без вызова на строку.
alter policy candidate_read on public.candidates using (
  (select auth.uid()) is not null
  and account_id = (select public.get_active_account_id())
  and (select public.has_permission('people.manage_candidates'))
  -- Скрытые (archived_at) анкеты видит только владелец аккаунта — это
  -- активный аккаунт, раз строка прошла проверку выше.
  and (archived_at is null
       or (select public.is_account_owner(public.get_active_account_id())))
);

do $$
declare
  t text;
begin
  foreach t in array array['candidate_appointments', 'candidate_events', 'candidate_files'] loop
    execute format(
      'alter policy candidate_read on public.%1$I using ('
      ' (select auth.uid()) is not null'
      ' and account_id = (select public.get_active_account_id())'
      ' and (select public.has_permission(''people.manage_candidates''))'
      ' and exists (select 1 from public.candidates c'
      '   where c.account_id = %1$I.account_id and c.id = %1$I.candidate_id))',
      t);
  end loop;
end $$;

alter policy candidate_read on public.candidate_comments using (
  deleted_at is null
  and (select auth.uid()) is not null
  and account_id = (select public.get_active_account_id())
  and (select public.has_permission('people.manage_candidates'))
  and exists (select 1 from public.candidates c
    where c.account_id = candidate_comments.account_id
      and c.id = candidate_comments.candidate_id)
);

-- Уведомления о кандидатах: колокольчик читается на каждой странице.
alter policy candidate_notification_access on public.notifications using (
  entity_type is distinct from 'candidate'
  or (
    (select auth.uid()) is not null
    and (select public.has_permission('people.manage_candidates'))
    and exists (select 1 from public.candidates c
      where c.id = notifications.entity_id
        and c.account_id = (select public.get_active_account_id()))
  )
);

alter policy candidate_shared_audit_access on public.audit_logs using (
  action_code not like 'candidate.%'
  or (
    (select auth.uid()) is not null
    and account_id = (select public.get_active_account_id())
    and (select public.has_permission('people.manage_candidates'))
  )
);

notify pgrst, 'reload schema';
