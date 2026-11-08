create table public.schedule_hidden_roles (
  venue_id uuid not null references public.venues(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (venue_id, role_id)
);

alter table public.schedule_hidden_roles enable row level security;
revoke all on public.schedule_hidden_roles from anon, authenticated;
grant select, insert, delete on public.schedule_hidden_roles to authenticated;

create policy schedule_hidden_roles_read on public.schedule_hidden_roles
  for select to authenticated
  using (venue_id = (select public.get_active_venue_id()));

create policy schedule_hidden_roles_hide on public.schedule_hidden_roles
  for insert to authenticated
  with check (
    venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('people.manage_roles'))
    and exists (select 1 from public.roles r where r.id = schedule_hidden_roles.role_id
      and (r.venue_id = schedule_hidden_roles.venue_id or (r.venue_id is null and r.code = 'owner')))
  );

create policy schedule_hidden_roles_show on public.schedule_hidden_roles
  for delete to authenticated
  using (
    venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('people.manage_roles'))
  );

notify pgrst, 'reload schema';
