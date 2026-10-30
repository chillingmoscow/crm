begin;
-- Coordinate the existing HR reminder and payroll reminder; no duplicate employee notification.
create or replace function public.payroll_commit_automation_run(p_venue uuid,p_date date,p_snapshot jsonb,p_plan jsonb,p_mode text,p_actor uuid default null,p_preview uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare run uuid;policy public.payroll_execution_policy;d jsonb;e public.payroll_employees;effect text;notify_employee boolean;expiry date;notified date;
begin
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||p_venue,0));
 select * into policy from public.payroll_execution_policy where venue_id=p_venue;
 if p_mode='native' and (policy.salary_from is null or p_date<policy.salary_from or not policy.legacy_stopped) then raise exception 'Включён режим сравнения. Прежняя автоматика ещё не передана Sheerly';end if;
 -- Tasks are deferred, gifts remain in Notion/n8n. Neither may reach salary here.
 if p_mode='native' and exists(select 1 from jsonb_array_elements(p_plan->'decisions') r where r->>'rule' in ('task','holiday','tenure')) then raise exception 'Задачи и подарки пока не перенесены';end if;
 run:=public.payroll_commit_automation_source_run(p_venue,p_date,p_snapshot,p_plan,p_mode,p_actor,p_preview);
 if p_mode='native' then
  for d in select value from jsonb_array_elements(p_plan->'decisions') loop
   if d->>'rule'<>'medical_reminder' or d->>'kind'<>'notification' or exists(select 1 from jsonb_array_elements(p_plan->'blockers') b where b->>'employeeId'=d->>'employeeId') then continue;end if;
   effect:=d->>'key';
   if exists(select 1 from public.payroll_automation_effects where event_key=effect) then continue;end if;
   select * into e from public.payroll_employees where id=(d->>'employeeId')::uuid and venue_id=p_venue;
   notify_employee:=true;expiry:=null;notified:=null;
   if d->>'key' like '%:expiry:%' and e.local_user_id is not null then
    select p.valid_until into expiry from public.payroll_automation_people p where p.employee_id=e.id;
    select h.medical_book_expiry_notified_for into notified from public.staff_account_details h where h.account_id=e.account_id and h.user_id=e.local_user_id for update;
    notify_employee:=notified is distinct from expiry;
   end if;
   insert into public.notifications(user_id,venue_id,type,category,title,body,link,entity_type,entity_id,payload)
   select distinct recipient,p_venue,'staff.medical_reminder','staff','Медицинская книжка · '||e.name,d->>'reason',case when recipient=e.local_user_id then '/profile' else '/people/automations' end,'payroll_automation_person',e.id,jsonb_build_object('event_key',effect)
   from (select e.local_user_id recipient union select owner_id from public.accounts where id=e.account_id union select p.user_id from public.user_venue_roles p join public.role_permissions rp on rp.role_id=p.role_id join public.permissions perm on perm.id=rp.permission_id where p.venue_id=p_venue and p.status='active' and p.fired_at is null and rp.granted and perm.code='payroll.configure') recipients
   where recipient is not null and (recipient is distinct from e.local_user_id or notify_employee) and (recipient=(select owner_id from public.accounts where id=e.account_id) or exists(select 1 from public.user_venue_roles m where m.user_id=recipient and m.venue_id=p_venue and m.status='active' and m.fired_at is null));
   if expiry is not null and notify_employee then
    update public.staff_account_details set medical_book_expiry_notified_for=expiry where account_id=e.account_id and user_id=e.local_user_id;
   end if;
   insert into public.payroll_automation_effects(event_key,account_id,venue_id,employee_id,decision,state,created_by) values(effect,e.account_id,p_venue,e.id,d,'applied',p_actor);
  end loop;
 end if;
 return run;
end $$;
create or replace function public.enqueue_medical_book_expiry_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  r record;
  v_days_left integer;
  v_title text;
  v_body  text;
begin
  for r in
    update public.staff_account_details sad
       set medical_book_expiry_notified_for = sad.medical_book_date
     where sad.medical_book_date is not null
       -- Payroll owns this reminder after the explicit venue cutover.
       and not exists (
         select 1 from public.payroll_employees e join public.payroll_execution_policy p on p.venue_id=e.venue_id
         join public.venues v on v.id=e.venue_id
         where e.local_user_id=sad.user_id and e.account_id=sad.account_id and e.active
           and p.legacy_stopped and p.salary_from<=(now() at time zone coalesce(v.timezone,'Europe/Moscow'))::date
       )
       and sad.medical_book_date <= current_date + interval '30 days'
       and (
         sad.medical_book_expiry_notified_for is null
         or sad.medical_book_expiry_notified_for <> sad.medical_book_date
       )
       and exists (
         select 1
         from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id  = sad.user_id
           and uvr.status   = 'active'
           and v.account_id = sad.account_id
       )
     returning sad.account_id, sad.user_id, sad.medical_book_date
  loop
    v_days_left := (r.medical_book_date - current_date)::integer;
    if v_days_left < 0 then
      v_title := 'Медкнижка просрочена';
      v_body  := 'Срок действия медкнижки истёк ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 '. Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    elsif v_days_left = 0 then
      v_title := 'Сегодня истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается сегодня. ' ||
                 'Сдайте анализы и обновите медкнижку, чтобы продолжать работу.';
    else
      v_title := 'Скоро истекает медкнижка';
      v_body  := 'Срок действия медкнижки заканчивается ' ||
                 to_char(r.medical_book_date, 'DD.MM.YYYY') ||
                 ' (через ' || v_days_left || ' дн.). ' ||
                 'Запишитесь на анализы заранее, чтобы не было перерыва в работе.';
    end if;

    insert into public.notifications (user_id, type, title, body, link)
    values (
      r.user_id,
      'staff.medical_book_expiring',
      v_title,
      v_body,
      '/profile'
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

notify pgrst,'reload schema';
commit;
