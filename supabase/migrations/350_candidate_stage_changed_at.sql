-- Срок на текущем этапе в списке кандидатов.
--
-- stage_changed_at — когда кандидат перешёл на нынешний этап (status).
-- Хранится в самой анкете, а не считается из журнала: список постраничный,
-- сортируется на сервере, и по сроку нужно сортировать.
--
-- Заполнение:
--   * существующие анкеты — время последней записи журнала, где статус стал
--     нынешним; если такой записи нет (новая анкета, импорт из Notion/Tilda) —
--     дата заявки;
--   * новая анкета — дата заявки (импорт приходит с прошлой датой);
--   * смена статуса — момент смены (триггер candidate_track_changes).
-- Пользователь поле не пишет: права на update у authenticated выданы
-- по колонкам (миграции 261, 268), новой колонки среди них нет.

begin;

alter table public.candidates add column stage_changed_at timestamptz;

-- Бэкфилл без триггера истории: он поднял бы revision и updated_at у каждой
-- анкеты, и открытые формы получили бы ложный конфликт версий.
alter table public.candidates disable trigger candidate_changes;
update public.candidates c
set stage_changed_at = coalesce(
  (select max(e.created_at)
     from public.candidate_events e
    where e.account_id = c.account_id
      and e.candidate_id = c.id
      and e.details #>> '{changes,status,new}' = c.status),
  c.submitted_at);
alter table public.candidates enable trigger candidate_changes;

alter table public.candidates alter column stage_changed_at set not null;

-- Новая анкета: этап начинается с даты заявки.
create or replace function public.candidate_stage_on_insert()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.stage_changed_at := coalesce(new.submitted_at, now());
  return new;
end $$;

create trigger candidate_stage_on_insert
  before insert on public.candidates
  for each row execute function public.candidate_stage_on_insert();

-- Тело как в 261; добавлена одна строка: при смене статуса запоминаем момент.
create or replace function public.candidate_track_changes() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare changes jsonb:='{}';k text;event_kind text;
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
 -- BEFORE INSERT cannot reference its parent yet; creation is handled by AFTER trigger below.
 if TG_OP='UPDATE' then
 insert into public.candidate_events(account_id,candidate_id,actor_id,kind,details) values(new.account_id,new.id,auth.uid(),event_kind,jsonb_build_object('changes',changes));
 insert into public.audit_logs(account_id,user_id,action_code,entity_type,entity_id,details) values(new.account_id,auth.uid(),'candidate.'||event_kind,'candidate',new.id,jsonb_build_object('name',new.full_name,'changes',changes));
 end if;return new;
end $$;

-- Сортировка списка по сроку на этапе.
create index candidates_stage_list
  on public.candidates(account_id, stage_changed_at, id)
  where archived_at is null and status <> 'hired';

commit;
