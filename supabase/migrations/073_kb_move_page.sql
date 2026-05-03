-- ============================================================
-- 073_kb_move_page.sql
-- Атомарный move страницы между родителями + reorder siblings.
--
-- Зачем: drag-n-drop в KB-tree теперь поддерживает 3 drop-zone'а
-- (sibling-before, sibling-after, become-child) + root-drop. Каждый
-- drop изменяет parent_id и/или position. Вместо двух последовательных
-- RPC (kb_move_page + kb_reorder_siblings) — единая транзакция,
-- иначе при сбое второй части дерево остаётся в inconsistent state
-- (parent сменился, но порядок не пересчитан → визуальный скачок
-- после reload).
--
-- Cycle prevention: проверяем что p_new_parent_id НЕ является
-- потомком p_id. Без этого юзер мог бы сделать «положи родителя
-- внутрь его же ребёнка» → recursive parent_id chain → бесконечный
-- цикл при tree-traversal.
--
-- Schema p_new_sibling_order:
--   uuid[] — порядок ВСЕХ siblings под p_new_parent_id, ВКЛЮЧАЯ
--   сам p_id на новой позиции. Server переписывает их position
--   0..N-1 в этом порядке.
--
-- Возвращаемые значения:
--   'ok'            — move + reorder применены
--   'cycle'         — p_new_parent_id оказался потомком p_id
--   'no_page'       — p_id не найден в active account
--   'no_parent'     — p_new_parent_id указан но не найден / удалён
--   'wrong_account' — какой-то id из p_new_sibling_order не из
--                     active account или не sibling нового parent'а
--   'forbidden'     — нет kb.create_pages (proxy для tree-edit)
-- ============================================================

create or replace function public.kb_move_page(
  p_id uuid,
  p_new_parent_id uuid,
  p_new_sibling_order uuid[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_old_parent_id uuid;
  v_cursor uuid;
  v_loop_guard integer := 0;
begin
  if not public.has_permission('kb.create_pages') then
    return 'forbidden';
  end if;

  -- Verify p_id живёт в active account.
  select parent_id into v_old_parent_id
    from public.kb_pages
   where id = p_id
     and account_id = v_account_id
     and deleted_at is null;
  if not found then
    return 'no_page';
  end if;

  -- Verify p_new_parent_id (если не NULL) живёт в active account.
  if p_new_parent_id is not null then
    if not exists (
      select 1 from public.kb_pages
       where id = p_new_parent_id
         and account_id = v_account_id
         and deleted_at is null
    ) then
      return 'no_parent';
    end if;

    -- Cycle check: нельзя сделать ancestor собственным потомком.
    -- Идём вверх от p_new_parent_id по parent_id; если встретим
    -- p_id — это цикл. v_loop_guard защитит от теоретически
    -- битой иерархии (>1000 уровней — нереалистично, но защитимся).
    v_cursor := p_new_parent_id;
    while v_cursor is not null and v_loop_guard < 1000 loop
      if v_cursor = p_id then
        return 'cycle';
      end if;
      select parent_id into v_cursor
        from public.kb_pages
       where id = v_cursor and account_id = v_account_id;
      v_loop_guard := v_loop_guard + 1;
    end loop;
  end if;

  -- Verify все id из ordered-list действительно живут в active account
  -- и реально станут siblings под p_new_parent_id (либо уже sibling,
  -- либо это p_id который мы перекидываем).
  if exists (
    select 1
      from unnest(p_new_sibling_order) as sid
     where not exists (
       select 1 from public.kb_pages
        where id = sid
          and account_id = v_account_id
          and deleted_at is null
          -- либо это уже sibling под new_parent (parent_id matches),
          -- либо это p_id который мы как раз перекидываем сюда.
          and (parent_id is not distinct from p_new_parent_id or id = p_id)
     )
  ) then
    return 'wrong_account';
  end if;

  -- 1. Меняем parent_id на странице.
  update public.kb_pages
     set parent_id = p_new_parent_id
   where id = p_id and account_id = v_account_id;

  -- 2. Атомарный re-numbering всех siblings 0..N-1 в указанном порядке.
  --    unnest WITH ORDINALITY даёт нам [(id, idx), ...] начиная с 1.
  with ord as (
    select id, (idx - 1) as new_pos
      from unnest(p_new_sibling_order) with ordinality as t(id, idx)
  )
  update public.kb_pages kp
     set position = ord.new_pos
    from ord
   where kp.id = ord.id
     and kp.account_id = v_account_id;

  return 'ok';
end;
$$;

comment on function public.kb_move_page(uuid, uuid, uuid[]) is
  'Атомарный move страницы: меняет parent_id + переписывает '
  'position всех siblings под новым родителем. Cycle-check защищает '
  'от закольцовывания иерархии. Используется UI drag-n-drop в KB-tree '
  'с 3 drop-zone (sibling-before/after/child) + root-drop.';

grant execute on function public.kb_move_page(uuid, uuid, uuid[]) to authenticated;
