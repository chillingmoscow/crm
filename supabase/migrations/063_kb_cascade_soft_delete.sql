-- ============================================================
-- 063_kb_cascade_soft_delete.sql
-- Каскадное soft-delete для KB-страниц. До: при удалении страницы
-- помечалась только она; дочерние «осиротевали» и оставались
-- видимыми как корневые в основном дереве. Пользователь жалуется:
-- хочется чтобы удаление родителя забирало всю ветку, а
-- восстановление возвращало её обратно с той же иерархией.
--
-- Подход: новый столбец `deleted_root_id` указывает на ту страницу,
-- которую пользователь удалил напрямую (для самой удалённой —
-- self.id, для каскадных потомков — id предка-«корня удаления»).
-- Это:
--   1. Позволяет фильтровать корзину по «корневым» удалениям
--      (каскадные потомки не показываются отдельными строками).
--   2. Делает restore симметричным — restoring root возвращает
--      все строки с deleted_root_id = root.id одной операцией.
--
-- Иерархия parent_id у потомков НЕ меняется при cascade-delete.
-- При restore parent_id остаются прежними → дерево восстанавливается
-- ровно в той же форме, в какой было.
-- ============================================================

alter table public.kb_pages
  add column if not exists deleted_root_id uuid;

-- Index для restoreCascade и листинга корзины.
create index if not exists kb_pages_deleted_root_idx
  on public.kb_pages(deleted_root_id)
  where deleted_at is not null;

comment on column public.kb_pages.deleted_root_id is
  'ID страницы, удалённой пользователем напрямую. Для самого root: '
  '= id; для каскадно-удалённых потомков: = id ancestor-root. '
  'Cтрока считается «корневой» в trash UI, если deleted_root_id = id.';

-- ============================================================
-- soft_delete_kb_page_cascade(p_id) — рекурсивно мечит страницу
-- + всех её живых потомков. Все строки получают одинаковые
-- deleted_at/deleted_by + deleted_root_id = p_id.
--
-- Гейтинг: kb.delete_pages (та же permission, что и плоский delete).
-- ============================================================

create or replace function public.kb_soft_delete_cascade(p_id uuid)
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
    raise exception 'kb_soft_delete_cascade: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_soft_delete_cascade: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.delete_pages') then
    raise exception 'kb_soft_delete_cascade: нет права kb.delete_pages' using errcode = '42501';
  end if;

  -- Проверяем, что root существует и в нашем account.
  if not exists (
    select 1 from public.kb_pages
    where id = p_id and account_id = v_account_id and deleted_at is null
  ) then
    raise exception 'kb_soft_delete_cascade: страница % не найдена / уже удалена', p_id
      using errcode = 'P0002';
  end if;

  with recursive subtree as (
    select id from public.kb_pages where id = p_id
    union all
    select kp.id
      from public.kb_pages kp
      join subtree s on kp.parent_id = s.id
     where kp.account_id = v_account_id
       and kp.deleted_at is null
  )
  update public.kb_pages
     set deleted_at      = now(),
         deleted_by      = v_uid,
         deleted_root_id = p_id
   where id in (select id from subtree)
     and account_id = v_account_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.kb_soft_delete_cascade(uuid) is
  'Рекурсивный soft-delete страницы + всех её живых потомков. '
  'Все строки получают одинаковые deleted_at/by + deleted_root_id = p_id.';

grant execute on function public.kb_soft_delete_cascade(uuid) to authenticated;

-- ============================================================
-- kb_restore_cascade(p_id) — восстанавливает страницу + всех,
-- кто был удалён в той же каскадной операции (deleted_root_id = p_id).
-- ============================================================

create or replace function public.kb_restore_cascade(p_id uuid)
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
    raise exception 'kb_restore_cascade: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_restore_cascade: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.delete_pages') then
    raise exception 'kb_restore_cascade: нет права kb.delete_pages' using errcode = '42501';
  end if;

  -- Восстанавливаем root + все каскадные потомки одной операцией.
  -- parent_id у потомков не трогаем — иерархия осталась той же.
  update public.kb_pages
     set deleted_at      = null,
         deleted_by      = null,
         deleted_root_id = null
   where account_id = v_account_id
     and (id = p_id or deleted_root_id = p_id)
     and deleted_at is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.kb_restore_cascade(uuid) is
  'Восстанавливает страницу + все строки, удалённые с ней каскадом '
  '(deleted_root_id = p_id). parent_id потомков не трогается.';

grant execute on function public.kb_restore_cascade(uuid) to authenticated;
