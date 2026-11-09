begin;

alter table public.schedule_templates
  add column subtitle text not null default ''
  check (char_length(subtitle) <= 80);

with titles as (
  select id, regexp_match(name, '^(.+?)[[:space:]]+·[[:space:]]+(день|вечер|полная смена)[[:space:]]*$', 'i') as parts
  from public.schedule_templates
)
update public.schedule_templates t
set name = btrim(titles.parts[1]),
    subtitle = titles.parts[2],
    version = t.version + 1,
    updated_at = now()
from titles
where t.id = titles.id and titles.parts is not null;

-- Keep the existing authorization, transaction and version checks for schedule edits.
do $migration$
declare
  definition text := pg_get_functiondef('public.schedule_command(text,jsonb)'::regprocedure);
  patch record;
begin
  for patch in
    select * from (values
      ($old$ vbreak integer;$old$, $new$$new$),
      ($old$vbreak:=coalesce((p_input->>'break_minutes')::integer,0); vdays:='{}';$old$, $new$vdays:='{}';$new$),
      ($old$    vst:=(item->>'start_time')::time; vet:=(item->>'end_time')::time;
    if vbreak>=(extract(epoch from (vet-vst))+case when vet<=vst then 86400 else 0 end)/60 then raise exception 'Перерыв должен быть короче каждого варианта шаблона';end if;
$old$, $new$$new$),
      ($old$start_time,end_time,variants,break_minutes,arrival_minutes,department_id,role_id,checklist_ids) values(v,trim(p_input->>'name'),p_input->>'color',vst,vet,vars,vbreak,coalesce((p_input->>'arrival_minutes')::integer,0),dept,pos,ids)$old$,
       $new$start_time,end_time,variants,subtitle,department_id,role_id,checklist_ids) values(v,trim(p_input->>'name'),p_input->>'color',vst,vet,vars,coalesce(btrim(p_input->>'subtitle'),t.subtitle,''),dept,pos,ids)$new$),
      ($old$variants=vars,break_minutes=vbreak,arrival_minutes=coalesce((p_input->>'arrival_minutes')::integer,0),department_id=dept$old$,
       $new$variants=vars,subtitle=coalesce(btrim(p_input->>'subtitle'),t.subtitle),break_minutes=0,arrival_minutes=0,department_id=dept$new$),
      ($old$starts_at,ends_at,break_minutes,arrival_minutes,note,checklist_ids)$old$,
       $new$starts_at,ends_at,note,checklist_ids)$new$),
      ($old$start_stamp,end_stamp,coalesce((p_input->>'break_minutes')::integer,0),coalesce((p_input->>'arrival_minutes')::integer,0),coalesce(p_input->>'note',''),ids)$old$,
       $new$start_stamp,end_stamp,coalesce(p_input->>'note',''),ids)$new$),
      ($old$break_minutes=coalesce((p_input->>'break_minutes')::integer,0),arrival_minutes=coalesce((p_input->>'arrival_minutes')::integer,0),note=$old$,
       $new$break_minutes=0,arrival_minutes=0,note=$new$)
    ) as patches(before_text, after_text)
  loop
    if strpos(definition, patch.before_text) = 0 then
      raise exception 'Изменилась реализация schedule_command';
    end if;
    definition := replace(definition, patch.before_text, patch.after_text);
  end loop;
  execute definition;
end
$migration$;

notify pgrst, 'reload schema';
commit;
