begin;

-- A shift credited by the published schedule is paid, but it is still a shift
-- without a Quick Resto mark. Since 324 such a schedule fact suppressed the
-- "missing mark" rule because the rule looked for any attendance row. Only
-- Quick Resto facts (external_id > 0) are evidence of a mark.
--
-- The rule is prospective: shifts that started before this migration keep the
-- previous outcome, so recalculating an earlier day creates no retroactive
-- warnings or fines.
alter table public.payroll_discipline_settings
  add column missing_mark_strict_from timestamptz not null default now();

comment on column public.payroll_discipline_settings.missing_mark_strict_from is
  'Смены, начатые с этого момента, получают предупреждение или штраф за отсутствие отметки Quick Resto, даже если выход засчитан по графику.';

do $$
declare
  definition text := pg_get_functiondef('private.payroll_generate_discipline()'::regprocedure);
  shift_fact text := 't.shift_id=p.id and t.status<>''ignored'' order by';
  day_fact text := 't.employee_id=r.employee_id and t.business_date=new.business_date) then';
begin
  if strpos(definition, shift_fact) = 0 or strpos(definition, day_fact) = 0 then
    raise exception 'Unexpected discipline contract: inspect payroll_generate_discipline before migrating';
  end if;
  definition := replace(definition, shift_fact,
    't.shift_id=p.id and t.status<>''ignored'' and (t.external_id>0 or p.starts_at<s.missing_mark_strict_from) order by');
  definition := replace(definition, day_fact,
    't.employee_id=r.employee_id and t.business_date=new.business_date and (t.external_id>0 or r.starts_at<s.missing_mark_strict_from)) then');
  execute definition;
end $$;

notify pgrst, 'reload schema';
commit;
