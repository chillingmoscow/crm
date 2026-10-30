-- A single transaction preserves the entire selection if any candidate cannot
-- be deleted. candidate_command rechecks account ownership, access and hiring.
create or replace function public.candidate_delete_many(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_id uuid;
  deleted integer := 0;
begin
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 100
     or array_position(p_ids, null) is not null then
    raise exception 'Выберите от 1 до 100 анкет';
  end if;
  for candidate_id in select distinct value from unnest(p_ids) as selected(value) order by value loop
    perform public.candidate_command('delete', candidate_id, '{}'::jsonb);
    deleted := deleted + 1;
  end loop;
  return deleted;
end;
$$;
revoke all on function public.candidate_delete_many(uuid[]) from public, anon;
grant execute on function public.candidate_delete_many(uuid[]) to authenticated;
