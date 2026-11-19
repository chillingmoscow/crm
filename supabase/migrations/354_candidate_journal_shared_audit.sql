-- Журнал кандидата переходит на общий журнал (audit_logs), как у сотрудника
-- и должности. Раньше карточка читала candidate_events, и журнал видел любой,
-- у кого есть доступ к кандидатам. Чтобы никто его не потерял:
--
--   1. audit_logs_select: события самой анкеты (entity_type = 'candidate' с
--      entity_id) читаются и с правом people.manage_candidates, без
--      org.view_audit. Настройки приёма заявок (entity_id пустой) и прочие
--      разделы журнала — по-прежнему только с org.view_audit. Restrictive
--      candidate_shared_audit_access (261) продолжает действовать поверх.
--      Политика остаётся одной permissive на SELECT — расширяем её OR'ом.
--   2. candidate_track_changes: приём через candidate_finish_hire идёт от
--      service_role, auth.uid() пустой, и запись «оформил(а) кандидата»
--      уходила в общий журнал от «Системы». Для 'hired' автор — hired_by
--      (его ставит тот же UPDATE). Существующие записи дозаполняем.
--   3. candidate_event_audit: удаление неперенесённого файла (file_removed)
--      тоже попадает в общий журнал как candidate.file.deleted.

begin;

drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select"
  on public.audit_logs for select
  using (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('org.view_audit'))
      or (
        entity_type = 'candidate'
        and entity_id is not null
        and action_code like 'candidate.%'
        and (select public.has_permission('people.manage_candidates'))
      )
    )
  );

-- Тело как в 350; изменён только автор события 'hired'.
create or replace function public.candidate_track_changes() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare changes jsonb:='{}';k text;event_kind text;actor uuid;
begin
 if TG_OP='DELETE' then
 if not exists(select 1 from public.accounts where id=old.account_id) then return old;end if;
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(old.account_id,auth.uid(),'candidate.deleted','candidate',old.id,jsonb_build_object('name',old.full_name));return old;
 end if;
 if TG_OP='INSERT' then event_kind:='created';
 else
 new.updated_at:=now();new.revision:=old.revision+1;
 if new.status is distinct from old.status then new.stage_changed_at:=now();end if;
 foreach k in array array['full_name','phone','desired_position','age','address','social','education','experience','plans','family_status','drivers_license','salary_expectation','status','responsible_id','hired_user_id','hired_venue_id','hired_role_id','archived_at'] loop
 if to_jsonb(old)->k is distinct from to_jsonb(new)->k then changes:=changes||jsonb_build_object(k,jsonb_build_object('old',to_jsonb(old)->k,'new',to_jsonb(new)->k));end if;
 end loop;
 if changes='{}' then return new;end if;
 event_kind:=case when old.archived_at is null and new.archived_at is not null then 'archived' when old.archived_at is not null and new.archived_at is null then 'restored' when old.hired_user_id is null and new.hired_user_id is not null then 'hired' else 'updated' end;
 end if;
 actor:=coalesce(auth.uid(),case when event_kind='hired' then new.hired_by end);
 -- BEFORE INSERT cannot reference its parent yet; creation is handled by AFTER trigger below.
 if TG_OP='UPDATE' then
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(new.account_id,new.id,actor,event_kind,jsonb_build_object('changes',changes));
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(new.account_id,actor,'candidate.'||event_kind,'candidate',new.id,jsonb_build_object('name',new.full_name,'changes',changes));
 end if;return new;
end $$;

update public.audit_logs a
set user_id = c.hired_by
from public.candidates c
where a.action_code = 'candidate.hired'
  and a.entity_type = 'candidate'
  and a.entity_id = c.id
  and a.account_id = c.account_id
  and a.user_id is null
  and c.hired_by is not null;

-- Тело как в 268; добавлен вид file_removed.
create or replace function public.candidate_event_audit() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare c public.candidates;d jsonb;code text;part text;person uuid;
begin
 if new.kind not in ('created','commented','appointment_created','appointment_updated','file_added','file_removed') then return new;end if;
 select * into c from public.candidates where id=new.candidate_id and account_id=new.account_id;
 if not found then return new;end if;
 d:=new.details||jsonb_build_object('name',c.full_name,'candidate_event_id',new.id);
 if new.kind in ('file_added','file_removed') then d:=d||jsonb_build_object('name_of_file',new.details->>'name');end if;
 if new.kind in ('appointment_created','appointment_updated') then
 foreach part in array array['before','after'] loop
 person:=nullif(d->part->>'interviewer_id','')::uuid;
 if person is not null then d:=jsonb_set(d,array[part,'interviewer_name'],to_jsonb(coalesce((select nullif(concat_ws(' ',first_name,last_name),'') from public.profiles where id=person),'Сотрудник')));end if;
 if nullif(d#>>array[part,'venue_id'],'') is not null then d:=jsonb_set(d,array[part,'venue_name'],to_jsonb(coalesce((select name from public.venues where id=(d#>>array[part,'venue_id'])::uuid),'Заведение')));end if;
 end loop;
 end if;
 code:=case new.kind when 'appointment_created' then 'candidate.appointment.created' when 'appointment_updated' then 'candidate.appointment.updated' when 'file_added' then 'candidate.file.created' when 'file_removed' then 'candidate.file.deleted' else 'candidate.'||new.kind end;
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(c.account_id,new.actor_id,code,'candidate',c.id,d);
 return new;
end $$;

commit;

notify pgrst, 'reload schema';
