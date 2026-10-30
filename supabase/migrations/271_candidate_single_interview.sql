-- One interview per candidate; any number of trial days. Existing records are preserved.
create unique index candidate_appointments_one_interview on public.candidate_appointments(account_id,candidate_id) where kind='interview';

create or replace function public.candidate_save_appointment(p_candidate uuid,p_mode text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;r public.candidate_appointments;payload jsonb;ident uuid;
begin
 if u is null or a is null or not private.candidate_access(a,true) then raise exception 'Нет доступа к кандидатам';end if;
 if p_mode not in ('schedule','result') or p_mode is null then raise exception 'Неизвестное действие со встречей';end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Проверьте данные встречи';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a for update;
 if not found or c.archived_at is not null then raise exception 'Кандидат недоступен';end if;
 ident:=nullif(p_input->>'id','')::uuid;
 if ident is not null then
  select * into r from public.candidate_appointments where id=ident and candidate_id=c.id and account_id=a for update;
  if not found then raise exception 'Встреча недоступна';end if;
  if r.revision is distinct from (p_input->>'revision')::integer then raise exception 'Встреча изменена. Обновите страницу';end if;
 end if;
 if p_mode='result' then
  if r.id is null then raise exception 'Сначала назначьте встречу';end if;
  if p_input - array['id','revision','outcome','notes','interview_feedback'] <> '{}'::jsonb then raise exception 'Дата и участники меняются через «Изменить назначение»';end if;
  if p_input->>'outcome' not in ('passed','rejected','no_show','canceled') or p_input->>'outcome' is null then raise exception 'Выберите результат встречи';end if;
  payload:=to_jsonb(r)||jsonb_build_object('outcome',p_input->>'outcome','notes',p_input->>'notes','interview_feedback',coalesce(p_input->'interview_feedback','{}'::jsonb));
 else
  if r.id is null and p_input->>'kind'='interview' and exists(select 1 from public.candidate_appointments where account_id=a and candidate_id=c.id and kind='interview') then raise exception 'Собеседование уже назначено. Измените существующее в разделе «Коммуникация»';end if;
  if p_input - array['id','revision','kind','venue_id','appointment_date','starts_at','timezone','location','interviewer_id'] <> '{}'::jsonb then raise exception 'Итог встречи меняется через «Заполнить результат»';end if;
  payload:=coalesce(to_jsonb(r),'{}'::jsonb)||p_input||jsonb_build_object(
   'outcome',coalesce(r.outcome,'scheduled'),'notes',r.notes,'interview_feedback',coalesce(r.interview_feedback,'{}'::jsonb));
 end if;
 return public.candidate_command('appointment',c.id,payload);
end $$;

notify pgrst,'reload schema';
