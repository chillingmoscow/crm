-- Local integration proof; every rule, event and message rolls back.
begin;
do $$
declare v uuid:='0bd81f1b-53be-4250-af97-eb5f693b30e1';a uuid;owner uuid;provider text;tz text;today date;cfg jsonb;g uuid;g2 uuid;viewer uuid;no_access uuid;r uuid;old_version integer;n integer;
begin
 select account_id into a from public.venues where id=v;select owner_id into owner from public.accounts where id=a;
 perform set_config('request.jwt.claim.sub',owner::text,true);perform set_config('app.ctx_ready','0',true);
 provider:=private.finance_execution_provider(a,v);select timezone into tz from public.sales_settings where venue_id=v;today:=(now()at time zone tz)::date;
 insert into private.crm_guest_sources(account_id,venue_id,provider,version,source_hash,facts,groups)values(a,v,provider,1,'qa','[]','[{"id":4,"title":"Silver","discountPercent":4,"promotable":true,"threshold":50000}]')on conflict(venue_id)do update set checked_at=now(),groups=excluded.groups;
 insert into private.crm_guests(account_id,venue_id,qr_id,source_data)values(a,v,900000010,jsonb_build_object('name','QA birthday','day',extract(day from today)::integer,'month',extract(month from today)::integer,'groupId',4))returning id into g;
 cfg:='{"autoRead":true,"intervalMinutes":60,"birthdayToday":true,"birthdayUpcoming":true,"leadDays":14,"groupTransitions":true,"groupId":4,"birthdayHour":0,"birthdayMinute":0,"groupHour":0,"groupMinute":0}';
 select coalesce(max(rules.version),0)into old_version from private.crm_guest_rules rules where venue_id=v;
 perform public.crm_guest_save_rules(v,old_version,cfg,'QA guest notifications');
 -- Starting mid-day must not notify birthdays already due before activation,
 -- and the existing target group is a baseline, not a new transition.
 n:=private.crm_guest_notify_due(a,v);
 if exists(select 1 from private.crm_guest_events where guest_id=g)then raise exception 'Activation emitted old guest events';end if;
 update private.crm_guest_rules set created_at=now()-interval '1 day'where venue_id=v and version=old_version+1;
 -- Explicit guest permission grants delivery, unrelated roles do not.
 insert into public.roles(venue_id,name,code)values(v,'QA guest recipient','qa_guest_recipient')returning id into r;
 insert into public.role_permissions(role_id,permission_id,granted)select r,id,true from public.permissions where code='crm.view_guests';
 viewer:=gen_random_uuid();no_access:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)select u,'authenticated','authenticated','crm-notice-'||u||'@qa.invalid','{}','{}',now(),now()from unnest(array[viewer,no_access])u;
 insert into public.profiles(id,first_name,active_venue_id)select u,'QA',v from unnest(array[viewer,no_access])u on conflict(id)do update set active_venue_id=v;
 insert into public.user_venue_roles(user_id,venue_id,role_id,status)values(viewer,v,r,'active');
 insert into private.crm_guests(account_id,venue_id,qr_id,source_data)values(a,v,900000011,jsonb_build_object('name','QA new Silver','groupId',4))returning id into g2;
 perform private.crm_guest_notify_due(a,v);perform private.crm_guest_notify_due(a,v);
 if(select count(*)from private.crm_guest_events where guest_id=g and kind='birthday')<>1 or(select count(*)from private.crm_guest_events where guest_id=g2 and kind='group')<>1 then raise exception 'Guest events missing or duplicated';end if;
 if(select count(*)from public.notifications where entity_id in(select id from private.crm_guest_events where guest_id in(g,g2))and user_id=viewer)<>2 then raise exception 'Guest recipient missed events';end if;
 if exists(select 1 from public.notifications where entity_id in(select id from private.crm_guest_events where guest_id in(g,g2))and user_id=no_access)then raise exception 'Guest message leaked';end if;
 if exists(select 1 from public.notifications where entity_id in(select id from private.crm_guest_events where guest_id in(g,g2))and pushed_at is null)then raise exception 'Guest events escaped to outbound push';end if;
 perform set_config('request.jwt.claim.sub',viewer::text,true);perform set_config('app.ctx_ready','0',true);if not public.crm_guest_notification_visible(v)then raise exception 'Guest recipient cannot see notification';end if;
 update public.role_permissions set granted=false where role_id=r;
 if public.crm_guest_notification_visible(v)then raise exception 'Revoked guest access still visible';end if;
 perform set_config('test.guest_revoked_user',viewer::text,true);perform set_config('test.guest_notice',g::text,true);
 raise notice 'PASS: activation baseline, birthday timing, once-only Silver, exact permission audience, revocation, no outbound push';
end $$;
set local role authenticated;
do $$begin
 if exists(select 1 from public.notifications where type like 'crm.guest.%')then raise exception 'Revoked role read guest notifications';end if;
end $$;
rollback;
