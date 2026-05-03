-- ============================================================
-- 067_kb_reorder_siblings.sql
-- RPC kb_reorder_siblings(p_parent_id, p_ordered_ids) — атомарно
-- проставляет position 0..N-1 всем siblings в указанном порядке.
--
-- Зачем: drag-drop в дереве страниц (см.
-- src/app/(dashboard)/knowledge/_components/kb-tree-nav.tsx)
-- меняет порядок siblings локально через arrayMove. До этой RPC
-- мы апдейтили только position у перетащенной ноды; остальные
-- siblings сохраняли свои старые position-значения, и tree.ts
-- (sort by (position, title)) при перезагрузке резолвил
-- одинаковые position'ы алфавитно, теряя «drag-order».
--
-- Эта функция переписывает position'ы ВСЕХ siblings одним UPDATE
-- с использованием unnest WITH ORDINALITY → atomic.
--
-- Гейтинг: проверяем что все p_ordered_ids принадлежат текущему
-- account и реально siblings (один parent_id). RLS на kb_pages
-- (kb.edit_any_page / edit_own_pages) тоже отрабатывает на UPDATE.
-- ============================================================

create or replace function public.kb_reorder_siblings(
  p_parent_id uuid,
  p_ordered_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_count      integer;
begin
  if v_uid is null then
    raise exception 'kb_reorder_siblings: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_reorder_siblings: нет активного account' using errcode = '28000';
  end if;

  -- Sanity-check: все id в нашем account, реально siblings
  -- (один parent_id, парсим NULL через is not distinct from), живые.
  if exists (
    select 1
      from unnest(p_ordered_ids) as oid
     where not exists (
       select 1 from public.kb_pages kp
        where kp.id = oid
          and kp.account_id = v_account_id
          and kp.parent_id is not distinct from p_parent_id
          and kp.deleted_at is null
     )
  ) then
    raise exception 'kb_reorder_siblings: id вне поддерева/account' using errcode = '42501';
  end if;

  -- Атомарный re-numbering position 0..N-1 в порядке p_ordered_ids.
  with ord as (
    select id, (idx - 1) as new_pos
      from unnest(p_ordered_ids) with ordinality as t(id, idx)
  )
  update public.kb_pages kp
     set position = ord.new_pos
    from ord
   where kp.id = ord.id
     and kp.account_id = v_account_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.kb_reorder_siblings(uuid, uuid[]) is
  'Атомарно перерасставляет position 0..N-1 у списка siblings в '
  'заданном порядке. Используется drag-drop в KB-дереве, чтобы '
  'order сохранился после reload (без этого только moved-row '
  'апдейтился, остальные siblings ловили tie на position).';

grant execute on function public.kb_reorder_siblings(uuid, uuid[]) to authenticated;
