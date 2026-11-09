begin;

-- Use the same slot lock in both calendar views and in the shift editor.
-- Existing shifts remain editable in place, including old duplicate slots.
do $migration$
declare
  definition text := pg_get_functiondef('public.schedule_command(text,jsonb)'::regprocedure);
  anchor text := $anchor$   if who is not null then
    perform pg_advisory_xact_lock(hashtextextended(who::text,0));$anchor$;
begin
  if strpos(definition, anchor) = 0 then
    raise exception 'Изменилась реализация schedule_command';
  end if;

  execute replace(definition, anchor, $patch$   if p_action in ('shift.create','shift.copy','shift.edit') then
    declare
      slot_template_id uuid := nullif(p_input->>'template_id','')::uuid;
      slot_day date := (start_stamp at time zone tz)::date;
    begin
      if slot_template_id is not null and (
        p_action <> 'shift.edit'
        or slot_template_id is distinct from prev.template_id
        or slot_day is distinct from (prev.starts_at at time zone tz)::date
      ) then
        perform pg_advisory_xact_lock(hashtextextended(
          'schedule-template-slot:' || v::text || ':' || slot_template_id::text || ':' || slot_day::text, 0
        ));
        select * into t from public.schedule_templates
          where id = slot_template_id and venue_id = v and not archived;
        if not found then raise exception 'Активный шаблон не найден'; end if;
        if jsonb_array_length(t.variants) > 0 and not exists (
          select 1 from jsonb_array_elements(t.variants) as variant(item)
          where variant.item->'days' @> jsonb_build_array(extract(isodow from slot_day)::integer)
        ) then
          raise exception 'Шаблон не действует в этот день';
        end if;
        if exists (
          select 1 from public.schedule_shifts sh
          where sh.venue_id = v and sh.template_id = slot_template_id
            and sh.starts_at >= (slot_day::timestamp at time zone tz)
            and sh.starts_at < ((slot_day + 1)::timestamp at time zone tz)
        ) then
          raise exception 'Смена по этому шаблону уже есть. Обновите расписание';
        end if;
      end if;
    end;
   end if;
   if who is not null then
    perform pg_advisory_xact_lock(hashtextextended(who::text,0));$patch$);
end
$migration$;

notify pgrst, 'reload schema';
commit;
