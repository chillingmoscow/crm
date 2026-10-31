-- A staff profile remains readable when a legacy placeholder cannot be
-- deserialized by GoTrue (e.g. NULL token fields or an infinite login ban).
-- Return only the identity fields already used by the staff UI; never mutate
-- Auth, expose credentials, or turn an HR record into a login account.
create or replace function private.staff_profile_identity(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := public.get_active_venue_id();
  a uuid := public.get_active_account_id();
  result jsonb;
begin
  if auth.uid() is null or v is null or a is null
    or not public.has_permission('people.view_staff')
    or not exists(select 1 from public.user_venue_roles caller
      where caller.user_id=auth.uid() and caller.venue_id=v and caller.status='active')
    or not exists(select 1 from public.venues venue
      where venue.id=v and venue.account_id=a and venue.archived_at is null)
  then raise exception 'Нет доступа к карточке сотрудника' using errcode='42501';end if;

  select jsonb_build_object(
    'id',u.id,'email',coalesce(u.email,''),
    'email_confirmed',u.email_confirmed_at is not null,
    'needs_password_setup',coalesce(u.raw_user_meta_data->'needs_password_setup'='true'::jsonb,false),
    'from_candidate',nullif(u.raw_app_meta_data->>'candidate_hire_id','') is not null,
    'created_at',case when isfinite(u.created_at) then u.created_at else null end
  ) into result
  from auth.users u join public.profiles p on p.id=u.id
  where u.id=p_user_id and exists(select 1 from public.user_venue_roles target
    where target.user_id=u.id and target.venue_id=v and target.status in ('active','fired'));
  return result;
end $$;
revoke all on function private.staff_profile_identity(uuid) from public,anon;
grant execute on function private.staff_profile_identity(uuid) to authenticated;
create or replace function public.get_staff_profile_identity(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.staff_profile_identity(p_user_id);
$$;
revoke all on function public.get_staff_profile_identity(uuid) from public,anon;
grant execute on function public.get_staff_profile_identity(uuid) to authenticated;
comment on function public.get_staff_profile_identity(uuid) is 'Minimal identity of an active or fired staff member in the active venue. Requires people.view_staff and active caller membership. Does not provision or modify Auth users.';
notify pgrst,'reload schema';
