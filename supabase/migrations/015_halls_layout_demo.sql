-- ============================================================
-- 015_halls_layout_demo.sql
-- Demo entities for hall planner MVP
-- ============================================================

create table if not exists public.venue_halls (
  id         uuid primary key default gen_random_uuid(),
  venue_id   text not null,
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists venue_halls_venue_sort_idx
  on public.venue_halls (venue_id, sort_order, created_at);

create table if not exists public.hall_layouts (
  hall_id        uuid primary key references public.venue_halls(id) on delete cascade,
  canvas_width   integer not null default 960,
  canvas_height  integer not null default 560,
  objects        jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);
