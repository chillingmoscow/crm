-- ============================================================
-- Миграция 112: фикс "column reference new_id is ambiguous" в
-- kb_duplicate_cascade.
--
-- Причина: функция объявлена как RETURNS TABLE (new_id uuid, new_slug
-- text). PostgreSQL создаёт неявные выходные переменные с теми же
-- именами. В строке
--   SELECT new_id, new_slug INTO v_new_root_id, v_new_root_slug
--     FROM _dup_map WHERE old_id = p_id;
-- имя new_id неоднозначно — это и колонка _dup_map, и выходная
-- переменная функции. Некоторые версии PG (14+) бросают
-- "column reference new_id is ambiguous".
--
-- Фикс: квалифицировать ссылку алиасом таблицы: dm.new_id / dm.new_slug.
-- ============================================================

create or replace function public.kb_duplicate_cascade(p_id uuid)
returns table (new_id uuid, new_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_account_id   uuid := public.get_active_account_id();
  v_root_parent  uuid;
  v_root_pos     integer;
  v_new_root_id  uuid;
  v_new_root_slug text;
begin
  if v_uid is null then
    raise exception 'kb_duplicate_cascade: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_duplicate_cascade: нет активного account' using errcode = '28000';
  end if;
  if not public.has_permission('kb.create_pages') then
    raise exception 'kb_duplicate_cascade: нет права kb.create_pages' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.kb_pages
    where id = p_id and account_id = v_account_id and deleted_at is null
  ) then
    raise exception 'kb_duplicate_cascade: страница % не найдена', p_id
      using errcode = 'P0002';
  end if;

  select parent_id, position + 1
    into v_root_parent, v_root_pos
    from public.kb_pages
   where id = p_id;

  update public.kb_pages
     set position = position + 1
   where account_id = v_account_id
     and parent_id is not distinct from v_root_parent
     and position >= v_root_pos
     and deleted_at is null;

  create temp table _dup_map (
    old_id   uuid primary key,
    new_id   uuid not null default gen_random_uuid(),
    new_slug text not null default public.kb_generate_slug()
  ) on commit drop;

  with recursive subtree as (
    select id from public.kb_pages
     where id = p_id and account_id = v_account_id and deleted_at is null
    union all
    select kp.id
      from public.kb_pages kp
      join subtree s on kp.parent_id = s.id
     where kp.account_id = v_account_id
       and kp.deleted_at is null
  )
  insert into _dup_map (old_id) select id from subtree;

  insert into public.kb_pages (
    id, account_id, parent_id, position, title, icon, icon_color,
    slug, content, plain_text, created_by, updated_by
  )
  select
    m.new_id,
    p.account_id,
    case
      when p.id = p_id then v_root_parent
      else (select pm.new_id from _dup_map pm where pm.old_id = p.parent_id)
    end as parent_id,
    case
      when p.id = p_id then v_root_pos
      else p.position
    end as position,
    case
      when p.id = p_id then p.title || ' (копия)'
      else p.title
    end as title,
    p.icon,
    p.icon_color,
    m.new_slug,
    p.content,
    p.plain_text,
    v_uid,
    v_uid
  from public.kb_pages p
  join _dup_map m on m.old_id = p.id;

  insert into public.kb_page_attachments (
    page_id, file_id, caption, attached_by, attached_at
  )
  select m.new_id, pa.file_id, pa.caption, pa.attached_by, pa.attached_at
    from public.kb_page_attachments pa
    join _dup_map m on m.old_id = pa.page_id;

  -- Квалифицированные dm.new_id / dm.new_slug — фикс ambiguity:
  -- без алиаса PG видит и колонку _dup_map, и выходную переменную
  -- RETURNS TABLE с тем же именем.
  select dm.new_id, dm.new_slug
    into v_new_root_id, v_new_root_slug
    from _dup_map dm
   where dm.old_id = p_id;

  return query select v_new_root_id, v_new_root_slug;
end;
$$;

comment on function public.kb_duplicate_cascade(uuid) is
  'Дублирует страницу + всё поддерево живых потомков. Возвращает '
  '(new_id, new_slug) нового root для redirect. Title корня получает '
  'суффикс « (копия)»; иерархия и attachments сохраняются.';
