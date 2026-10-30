-- Author-owned comments and distinct scheduling/result commands.
alter table public.candidate_comments
 add column revision integer not null default 1 check (revision > 0),
 add column updated_at timestamptz not null default now(),
 add column deleted_at timestamptz;

alter policy candidate_read on public.candidate_comments using (
 deleted_at is null and private.candidate_access(account_id,false)
 and exists(select 1 from public.candidates c where c.account_id=candidate_comments.account_id and c.id=candidate_comments.candidate_id)
);

create function public.candidate_edit_comment(p_candidate uuid,p_comment uuid,p_revision integer,p_body text default null,p_delete boolean default false)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
declare a uuid:=public.get_active_account_id();u uuid:=auth.uid();c public.candidates;r public.candidate_comments;event_kind text;
begin
 if u is null or a is null or not private.candidate_access(a,true) then raise exception 'Нет доступа к кандидатам';end if;
 select * into c from public.candidates where id=p_candidate and account_id=a for update;
 if not found or c.archived_at is not null then raise exception 'Кандидат недоступен';end if;
 select * into r from public.candidate_comments where id=p_comment and candidate_id=c.id and account_id=a and deleted_at is null for update;
 if not found then raise exception 'Комментарий недоступен';end if;
 if r.author_id is distinct from u then raise exception 'Изменять и удалять комментарий может только его автор';end if;
 if r.revision is distinct from p_revision then raise exception 'Комментарий изменён. Обновите страницу';end if;
 if not p_delete and (p_body is null or length(trim(p_body)) not between 1 and 12000) then raise exception 'Введите комментарий до 12000 символов';end if;
 update public.candidate_comments set
  body=case when p_delete then body else trim(p_body) end,
  deleted_at=case when p_delete then now() else null end,
  updated_at=now(),revision=revision+1 where id=r.id;
 event_kind:=case when p_delete then 'comment_deleted' else 'comment_updated' end;
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details)
 values(a,c.id,u,event_kind,jsonb_build_object('comment_id',r.id,'before',r.body,'after',case when p_delete then null else trim(p_body) end));
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details)
 values(a,u,case when p_delete then 'candidate.comment.deleted' else 'candidate.comment.updated' end,'candidate',c.id,
  jsonb_build_object('name',c.full_name,'comment_id',r.id,'before',r.body,'after',case when p_delete then null else trim(p_body) end));
end $$;
revoke all on function public.candidate_edit_comment(uuid,uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.candidate_edit_comment(uuid,uuid,integer,text,boolean) to authenticated;

-- Read the current counterpart under the same locks as candidate_command.
-- Neither form sends or overwrites fields owned by the other form.
create function public.candidate_save_appointment(p_candidate uuid,p_mode text,p_input jsonb)
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
  if p_input - array['id','revision','kind','venue_id','appointment_date','starts_at','timezone','location','interviewer_id'] <> '{}'::jsonb then raise exception 'Итог встречи меняется через «Заполнить результат»';end if;
  payload:=coalesce(to_jsonb(r),'{}'::jsonb)||p_input||jsonb_build_object(
   'outcome',coalesce(r.outcome,'scheduled'),'notes',r.notes,'interview_feedback',coalesce(r.interview_feedback,'{}'::jsonb));
 end if;
 return public.candidate_command('appointment',c.id,payload);
end $$;
revoke all on function public.candidate_save_appointment(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.candidate_save_appointment(uuid,text,jsonb) to authenticated;
notify pgrst,'reload schema';
