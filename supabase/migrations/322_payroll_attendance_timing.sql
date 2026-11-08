-- Timing differences remain available to lateness rules through the actual timestamps.
-- Clear only the legacy flag for a completed, matched shift.
update public.payroll_attendance
set status = 'confirmed', issue = null, version = version + 1
where status = 'deviation'
  and issue = 'План и факт отличаются более чем на 15 минут'
  and reviewed_by is null
  and shift_id is not null
  and ends_at is not null;
