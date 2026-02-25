-- ============================================================
-- layout_demo_seed.sql
-- Demo seed for /invite/layout-demo
-- ============================================================

begin;

-- Idempotent reset for demo venue only
delete from public.hall_layouts
where hall_id in (
  select id
  from public.venue_halls
  where venue_id = 'demo-venue'
);

delete from public.venue_halls
where venue_id = 'demo-venue';

with inserted_halls as (
  insert into public.venue_halls (venue_id, name, sort_order)
  values
    ('demo-venue', 'Основной зал', 1),
    ('demo-venue', 'VIP зал', 2)
  returning id, name
)
insert into public.hall_layouts (
  hall_id,
  canvas_width,
  canvas_height,
  objects,
  updated_at
)
select
  h.id,
  960,
  560,
  case
    when h.name = 'Основной зал' then
      '[
        {"id":"main_t1","kind":"table","shape":"circle","x":80,"y":70,"width":90,"height":90,"rotation":0,"table_number":"1","capacity":4},
        {"id":"main_t2","kind":"table","shape":"circle","x":220,"y":70,"width":90,"height":90,"rotation":0,"table_number":"2","capacity":4},
        {"id":"main_t3","kind":"table","shape":"rect","x":380,"y":72,"width":120,"height":80,"rotation":0,"table_number":"3","capacity":6},
        {"id":"main_t4","kind":"table","shape":"rect","x":560,"y":90,"width":140,"height":80,"rotation":15,"table_number":"4","capacity":6},
        {"id":"main_t5","kind":"table","shape":"circle","x":720,"y":280,"width":90,"height":90,"rotation":0,"table_number":"5","capacity":4},
        {"id":"main_p1","kind":"partition","shape":"rect","x":320,"y":240,"width":260,"height":18,"rotation":0},
        {"id":"main_p2","kind":"partition","shape":"rect","x":120,"y":360,"width":360,"height":18,"rotation":-8}
      ]'::jsonb
    else
      '[
        {"id":"vip_t1","kind":"table","shape":"rect","x":140,"y":120,"width":130,"height":80,"rotation":0,"table_number":"VIP-1","capacity":6},
        {"id":"vip_t2","kind":"table","shape":"circle","x":360,"y":120,"width":100,"height":100,"rotation":0,"table_number":"VIP-2","capacity":5},
        {"id":"vip_t3","kind":"table","shape":"rect","x":560,"y":300,"width":150,"height":90,"rotation":-12,"table_number":"VIP-3","capacity":8},
        {"id":"vip_p1","kind":"partition","shape":"rect","x":300,"y":300,"width":220,"height":20,"rotation":0}
      ]'::jsonb
  end,
  now()
from inserted_halls h;

commit;
