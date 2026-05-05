-- ============================================================
-- 106_kb_comments_page_id_realtime_filter.sql
-- Denormalize kb_comments.page_id so Realtime subscriptions can be
-- scoped to one KB page instead of receiving every comment in account.
-- ============================================================

alter table public.kb_comments
  add column if not exists page_id uuid references public.kb_pages(id) on delete cascade;

update public.kb_comments c
   set page_id = t.page_id
  from public.kb_threads t
 where c.thread_id = t.id
   and c.page_id is null;

alter table public.kb_comments
  alter column page_id set not null;

create index if not exists kb_comments_page_idx
  on public.kb_comments(page_id, created_at asc);

create or replace function public.kb_comments_set_page_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_page_id uuid;
begin
  select t.page_id
    into v_page_id
    from public.kb_threads t
   where t.id = new.thread_id;

  if v_page_id is null then
    raise exception 'kb_comments: thread % not found', new.thread_id
      using errcode = '23503';
  end if;

  new.page_id := v_page_id;
  return new;
end;
$$;

drop trigger if exists kb_comments_set_page_id on public.kb_comments;
create trigger kb_comments_set_page_id
  before insert or update of thread_id on public.kb_comments
  for each row execute function public.kb_comments_set_page_id();

comment on column public.kb_comments.page_id is
  'Denormalized from kb_threads.page_id for page-scoped realtime filters.';
