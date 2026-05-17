-- ============================================================
-- 175_kb_hard_delete.sql
-- Окончательное удаление из корзины базы знаний. До: страницы
-- только soft-delete'ились (063), окончательно убрать их из БД
-- было нельзя — корзина копилась бесконечно. Пользователь хочет
-- кнопки «Удалить навсегда» (по одной странице / выбранным) и
-- «Очистить корзину» целиком.
--
-- Подход: симметрично 063 — security-definer RPC, гейт
-- kb.delete_pages, операции только над уже soft-deleted строками
-- активного account'а. Дочерние таблицы (versions, reads,
-- favorites, comments, links, view-sessions, attachments,
-- embeddings, collections) висят на FK с ON DELETE CASCADE —
-- физический DELETE по kb_pages забирает их автоматически.
--
-- audit_logs.entity_id НЕ имеет FK на kb_pages (см.
-- src/lib/knowledge/audit.ts) — журнал событий сознательно
-- переживает hard-delete страницы, это корректно для аудита.
-- ============================================================

-- ============================================================
-- kb_hard_delete_cascade(p_id) — физически удаляет soft-deleted
-- root + все строки, удалённые с ним каскадом (deleted_root_id
-- = p_id). Работает только если строка уже в корзине.
-- ============================================================

create or replace function public.kb_hard_delete_cascade(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_count      integer;
begin
  if v_uid is null then
    raise exception 'kb_hard_delete_cascade: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_hard_delete_cascade: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.delete_pages') then
    raise exception 'kb_hard_delete_cascade: нет права kb.delete_pages' using errcode = '42501';
  end if;

  -- p_id должен быть КОРНЕВОЙ записью удаления в нашем account'е и
  -- уже в корзине. Корень = deleted_root_id = id (063) либо
  -- legacy-NULL (строки, удалённые до 063). Если передать id
  -- каскадного потомка — DELETE снёс бы его поддерево по self-FK
  -- ON DELETE CASCADE (053), оставив реальный root в корзине и
  -- сломав инвариант «restore возвращает всю ветку». Поэтому
  -- потомков отклоняем (Codex #314 P1).
  if not exists (
    select 1 from public.kb_pages
    where id = p_id
      and account_id = v_account_id
      and deleted_at is not null
      and (deleted_root_id = id or deleted_root_id is null)
  ) then
    raise exception 'kb_hard_delete_cascade: % не корневая запись корзины', p_id
      using errcode = 'P0002';
  end if;

  -- Один DELETE по всей каскадной группе. Self-FK parent_id
  -- удовлетворяется: вся ветка уходит в рамках одного statement'а,
  -- orphan'ов не остаётся. Дочерние таблицы — ON DELETE CASCADE.
  delete from public.kb_pages
   where account_id = v_account_id
     and deleted_at is not null
     and (id = p_id or deleted_root_id = p_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.kb_hard_delete_cascade(uuid) is
  'Физически удаляет soft-deleted страницу + каскадных потомков '
  '(deleted_root_id = p_id). Только над строками уже в корзине.';

grant execute on function public.kb_hard_delete_cascade(uuid) to authenticated;

-- ============================================================
-- kb_empty_trash() — физически удаляет ВСЕ soft-deleted строки
-- активного account'а. Возвращает число удалённых строк.
-- ============================================================

create or replace function public.kb_empty_trash()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_count      integer;
begin
  if v_uid is null then
    raise exception 'kb_empty_trash: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_empty_trash: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.delete_pages') then
    raise exception 'kb_empty_trash: нет права kb.delete_pages' using errcode = '42501';
  end if;

  delete from public.kb_pages
   where account_id = v_account_id
     and deleted_at is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.kb_empty_trash() is
  'Физически удаляет все soft-deleted строки активного account. '
  'Гейт kb.delete_pages. Возвращает число удалённых строк.';

grant execute on function public.kb_empty_trash() to authenticated;
