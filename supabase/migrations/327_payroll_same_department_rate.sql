begin;

-- Start the new rule prospectively. Refreshing a previously worked day must
-- keep using the pay selection policy in effect when its shifts began.
alter table public.payroll_settings
  add column same_department_rate_from timestamptz not null default now();

notify pgrst, 'reload schema';
commit;
