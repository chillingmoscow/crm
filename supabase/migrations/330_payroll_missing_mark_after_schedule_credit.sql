begin;

-- A shift credited by the published schedule is paid, but it is still a shift
-- without a Quick Resto mark. Since 324 such a schedule fact suppressed the
-- "missing mark" rule because the rule looked for any attendance row. Only
-- Quick Resto facts (external_id > 0) are evidence of a mark.
--
-- The rule is prospective: shifts that started before this migration keep the
-- previous outcome, so recalculating an earlier day creates no retroactive
-- warnings or fines.
--
-- A manager's explicit "include" decision forgives the missing mark (below).
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
    't.employee_id=r.employee_id and t.business_date=new.business_date and (t.external_id>0 or r.starts_at<s.missing_mark_strict_from))'
    || ' and not exists(select 1 from public.payroll_schedule_reviews rv where rv.shift_id=r.shift_id and rv.employee_id=r.employee_id and rv.decision=''include'') then');
  execute definition;
end $$;

-- A manager's explicit "count this shift" also forgives the missing mark. The
-- warning is usually created before the review (on day completion), so the
-- review cancels it; the automation key keeps a recalculation from re-adding it.
do $$
declare
  definition text := pg_get_functiondef('public.payroll_review_schedule_shift(uuid,integer,timestamptz,text,text)'::regprocedure);
  anchor text := 'returning * into saved;';
begin
  if strpos(definition, anchor) = 0 then
    raise exception 'Unexpected schedule review contract: inspect payroll_review_schedule_shift before migrating';
  end if;
  definition := replace(definition, anchor, anchor || '
  if p_decision = ''include'' then
    update public.payroll_adjustments
      set deleted_at = now(), deleted_by = actor, delete_reason = ''Выход засчитан вручную: '' || trim(p_reason)
      where account_id = account and venue_id = venue and employee_id = employee.id
        and origin = ''missing_clockin'' and automation_key = plan.id || '':attendance'' and deleted_at is null;
  end if;');
  execute definition;
end $$;

notify pgrst, 'reload schema';
commit;
