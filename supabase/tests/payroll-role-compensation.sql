-- Append-only conditions, role boundaries and history; all fixtures roll back.
begin;
do $$
declare u uuid;a uuid;v uuid;m public.payroll_models;r public.payroll_rule_versions;payload jsonb;new_id uuid;count_before integer;outside uuid; fixture uuid;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 select * into m from public.payroll_models where venue_id=v and is_role_default and name='Старший бармен';
 if m.id is null or (select name from public.roles where id=m.role_id)<>'Старший бармен' then raise exception 'Senior position not separated';end if;
 select * into r from public.payroll_rule_versions where model_id=m.id and employee_id is null order by valid_from desc,created_at desc,id desc limit 1;
 select count(*) into count_before from public.payroll_rule_versions where model_id=m.id;
 payload:=jsonb_build_object('valid_from','2040-01-01','reason','New conditions regression','monthly_amount',1000,'rates',r.rates,'experience_steps',r.experience_steps,'tenure_requires_exam',r.tenure_requires_exam,'config',r.config||'{"shift_pay":true,"extras_enabled":false}'::jsonb);
 new_id:=(public.payroll_save_role_rule(m.role_id,payload,r.id)->>'id')::uuid;
 if (select count(*) from public.payroll_rule_versions where model_id=m.id)<>count_before+1 then raise exception 'Not append only';end if;
 if (select to_jsonb(x)-'change_reason' from public.payroll_rule_versions x where id=r.id)<>to_jsonb(r)-'change_reason' then raise exception 'Old conditions changed';end if;
 if not exists(select 1 from public.payroll_rule_versions where id=new_id and change_reason='New conditions regression' and rates=r.rates and experience_steps=r.experience_steps and config->>'extras_enabled'='false') then raise exception 'Condition fields lost';end if;
 if not exists(select 1 from public.audit_logs where entity_id=new_id and user_id=u and details->'after'->>'change_reason'='New conditions regression') then raise exception 'Missing actor or reason in audit';end if;
 begin perform public.payroll_save_role_rule(m.role_id,payload,r.id);raise exception 'stale-write-accepted';exception when others then if sqlerrm='stale-write-accepted' then raise;end if;end;
 select id into outside from public.roles where venue_id<>v limit 1;
 if outside is not null then
  begin perform public.payroll_save_role_rule(outside,payload,null);raise exception 'cross-venue-accepted';exception when others then if sqlerrm='cross-venue-accepted' then raise;end if;end;
 end if;
 insert into public.payroll_employees(account_id,venue_id,name,role_name,opening_confirmed) values(a,v,'Position rollback fixture','Test',true) returning id into fixture;
 perform public.payroll_assign_position(fixture,m.role_id,'2040-01-01');
 if not exists(select 1 from public.payroll_employee_models where employee_id=fixture and model_id=m.id and valid_from='2040-01-01') then raise exception 'Position date lost';end if;
 if not exists(select 1 from public.audit_logs where entity_id=fixture and user_id=u and action_code='payroll.position.assigned') then raise exception 'Position audit missing';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('app.ctx_ready','0',true);
 begin perform public.payroll_save_role_rule(m.role_id,payload,new_id);raise exception 'anonymous-accepted';exception when others then if sqlerrm='anonymous-accepted' then raise;end if;end;
end $$;
rollback;
