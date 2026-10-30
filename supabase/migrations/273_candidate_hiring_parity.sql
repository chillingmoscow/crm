-- Optional payment link is per venue; never hard-code one tenant's recipient.
alter table public.candidate_employment_settings add column tips_uri text
 check(tips_uri is null or (tips_uri ~ '^https://' and length(tips_uri)<=1000));
alter table public.candidate_jobs drop constraint candidate_jobs_kind_check;
alter table public.candidate_jobs add constraint candidate_jobs_kind_check check(kind in ('notify','file_cleanup','hired'));
create function private.candidate_queue_hire_notice() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 insert into public.candidate_jobs(account_id,candidate_id,kind,payload)
 values(new.account_id,new.candidate_id,'hired',jsonb_build_object(
 'hire_id',new.id,'user_id',new.target_user_id,
 'name',trim(new.input->>'first_name')||' '||trim(new.input->>'last_name'),
 'role_name',(select name from public.roles where id=(new.input->>'role_id')::uuid)))
 on conflict(candidate_id,kind) do nothing;
 return new;
end $$;
revoke all on function private.candidate_queue_hire_notice() from public,anon,authenticated;
create trigger candidate_hire_notice after update of state on public.candidate_hires
 for each row when(old.state is distinct from 'complete' and new.state='complete') execute function private.candidate_queue_hire_notice();
