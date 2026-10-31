begin;
do $test$
declare u uuid;a uuid;v uuid;foreign_venue record;
begin
 select id into u from auth.users where email='owner@test.com';
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('app.ctx_ready','0',true);
 a:=public.get_active_account_id();v:=public.get_active_venue_id();
 insert into public.sales_statistics_archive(account_id,venue_id,month,metrics,weekday_turnover,origin,source_hash,captured_at,imported_by)
 values(a,v,'2024-01-01','{"turnover":100,"bar":0,"alcoholShare":17}', '[null,0,1,2,3,4,5]','{"range":"Statistics!A2:AC2"}',repeat('a',64),'2026-10-31T12:00:00Z',u);
 select id,account_id into foreign_venue from public.venues where id<>v limit 1;
 if found then
  insert into public.sales_statistics_archive(account_id,venue_id,month,metrics,weekday_turnover,origin,source_hash,captured_at,imported_by)
  values(foreign_venue.account_id,foreign_venue.id,'2023-01-01','{"turnover":999}', '[null,null,null,null,null,null,null]','{}',repeat('b',64),'2026-10-31T12:00:00Z',u);
 end if;
 if has_table_privilege('authenticated','public.sales_statistics_archive','INSERT') or has_table_privilege('authenticated','public.sales_statistics_archive','UPDATE') or has_table_privilege('authenticated','public.sales_statistics_archive','DELETE') or has_table_privilege('anon','public.sales_statistics_archive','SELECT') then raise exception 'Archive grants unsafe';end if;
end $test$;
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.sales_statistics_archive where month='2024-01-01') then raise exception 'Owner cannot read active venue';end if;
 if exists(select 1 from public.sales_statistics_archive where month='2023-01-01') then raise exception 'Foreign venue leak';end if;
 begin
  update public.sales_statistics_archive set metrics='{}';raise exception 'Archive overwritten';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','',true),set_config('app.ctx_ready','0',true);
do $$ begin if exists(select 1 from public.sales_statistics_archive) then raise exception 'Scope leak';end if;end $$;
rollback;
