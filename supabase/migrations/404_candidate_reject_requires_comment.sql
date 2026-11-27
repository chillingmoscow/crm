-- «Не подходит» — только с комментарием, почему.
--
-- Отказ ставят два пути:
--   * перенос на этап «Не подходит» (доска, меню этапа) — новый
--     candidate_reject: этап и комментарий одной транзакцией;
--   * итог встречи «Не прошёл» — candidate_save_appointment, комментарий
--     пишется в итог встречи (у собеседования он и раньше был обязателен,
--     теперь и у стажировки).
-- Оба пути ставят транзакционный флаг app.candidate_reject_noted, а триггер
-- отклоняет любой другой переход в «Не подходит» (прямой candidate_command,
-- update по таблице).

create or replace function public.candidate_reject_requires_note()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected'
     and coalesce(current_setting('app.candidate_reject_noted', true), '') <> '1' then
    raise exception 'Напишите, почему кандидат не подходит';
  end if;
  return new;
end
$$;

revoke all on function public.candidate_reject_requires_note() from public, anon, authenticated;

drop trigger if exists candidates_reject_requires_note on public.candidates;
create trigger candidates_reject_requires_note
  before update of status on public.candidates
  for each row execute function public.candidate_reject_requires_note();

create or replace function public.candidate_reject(
  p_candidate uuid,
  p_revision integer,
  p_comment text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  body text := trim(coalesce(p_comment, ''));
  c public.candidates;
begin
  if body = '' then raise exception 'Напишите, почему кандидат не подходит'; end if;
  if length(body) > 12000 then raise exception 'Комментарий слишком длинный'; end if;
  if p_request_key is null then raise exception 'Повторите действие'; end if;
  -- Сначала этап: candidate_command сверяет ревизию анкеты, права и архив.
  perform set_config('app.candidate_reject_noted', '1', true);
  perform public.candidate_command('update', p_candidate,
    jsonb_build_object('revision', p_revision, 'status', 'rejected'));
  perform set_config('app.candidate_reject_noted', '', true);
  perform public.candidate_command('comment', p_candidate,
    jsonb_build_object('body', body, 'request_key', p_request_key));
  select * into c from public.candidates where id = p_candidate;
  return jsonb_build_object('id', c.id, 'revision', c.revision, 'status', c.status);
end
$$;

revoke all on function public.candidate_reject(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.candidate_reject(uuid, integer, text, uuid) to authenticated;

-- Тело — из 271; добавлены обязательный комментарий к «Не прошёл» и флаг.
create or replace function public.candidate_save_appointment(p_candidate uuid,p_mode text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;r public.candidate_appointments;payload jsonb;ident uuid;result jsonb;
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
  if p_input->>'outcome'='rejected' then
   if nullif(trim(p_input->>'notes'),'') is null then raise exception 'Напишите, почему кандидат не подходит';end if;
   perform set_config('app.candidate_reject_noted','1',true);
  end if;
  payload:=to_jsonb(r)||jsonb_build_object('outcome',p_input->>'outcome','notes',p_input->>'notes','interview_feedback',coalesce(p_input->'interview_feedback','{}'::jsonb));
 else
  if r.id is null and p_input->>'kind'='interview' and exists(select 1 from public.candidate_appointments where account_id=a and candidate_id=c.id and kind='interview') then raise exception 'Собеседование уже назначено. Измените существующее в разделе «Коммуникация»';end if;
  if p_input - array['id','revision','kind','venue_id','appointment_date','starts_at','timezone','location','interviewer_id'] <> '{}'::jsonb then raise exception 'Итог встречи меняется через «Заполнить результат»';end if;
  payload:=coalesce(to_jsonb(r),'{}'::jsonb)||p_input||jsonb_build_object(
   'outcome',coalesce(r.outcome,'scheduled'),'notes',r.notes,'interview_feedback',coalesce(r.interview_feedback,'{}'::jsonb));
 end if;
 result:=public.candidate_command('appointment',c.id,payload);
 perform set_config('app.candidate_reject_noted','',true);
 return result;
end $$;

revoke all on function public.candidate_save_appointment(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.candidate_save_appointment(uuid,text,jsonb) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.candidate_reject(uuid,integer,text,uuid)', 'execute') then
    raise exception 'candidate_reject доступна анониму';
  end if;
  if not has_function_privilege('authenticated', 'public.candidate_reject(uuid,integer,text,uuid)', 'execute') then
    raise exception 'candidate_reject недоступна пользователям';
  end if;
end
$$;

notify pgrst, 'reload schema';
