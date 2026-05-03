-- ============================================================
-- 064_kb_duplicate_cascade.sql
-- Каскадное дублирование страницы вместе со всем поддеревом.
-- Notion-style операция «Дублировать»: создаёт копию страницы +
-- всех живых потомков в той же позиции в дереве (новые id/slug),
-- сохраняя относительную иерархию parent → child.
--
-- Решения:
--   • Title нового root-page: «<original> (копия)». Дети сохраняют
--     свои оригинальные title.
--   • content jsonb / plain_text / icon / icon_color → копируются
--     1-в-1 (BlockNote-блоки внутри копии ProseMirror подгонит при
--     первом save'е, нам не нужно перегенерировать block-id'ы).
--   • kb_page_attachments → копируем pivot-строки (новая страница
--     ссылается на те же account_files; storage-объекты не дублируются,
--     т.к. это shared-references — ровно как в Notion: «duplicate page»
--     не делает копию приложенных файлов).
--   • kb_page_links → не копируем; пересоберутся на первом save через
--     kb_save_page (link_targets argument).
--   • kb_page_versions → НЕ копируем; новая страница начинает свою
--     историю с первого save'а.
--   • Position нового root-page: max(position) + 1 среди siblings
--     оригинала (вставляется сразу после исходного).
--
-- Гейтинг: kb.create_pages — те же права что и для plain insert.
-- ============================================================

-- ── Helper: генератор slug'а в той же стилистике, что src/lib/knowledge/slug.ts.
--    32 символа × 8 позиций ≈ 1.1e12 комбинаций. Уникальность
--    enforced unique-constraint на (account_id, slug) — на коллизию
--    (вероятность ~0) PG бросит 23505 и upper-level retry разрулит.
create or replace function public.kb_generate_slug()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := '23456789abcdefghjkmnpqrstuvwxyz';
  result   text := '';
  i        integer;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * 32)::int, 1);
  end loop;
  return result;
end;
$$;

comment on function public.kb_generate_slug() is
  'Случайный 8-символьный slug в alphabet [23456789a-z без ambiguous]. '
  'Совпадает по стилю с src/lib/knowledge/slug.ts (nanoid).';

-- ============================================================
-- kb_duplicate_cascade(p_id) — дублирует страницу + всё поддерево.
-- Возвращает запись { id, slug } новой root-страницы (для redirect
-- на стороне клиента).
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

  -- Source-страница должна существовать в нашем account и быть живой.
  if not exists (
    select 1 from public.kb_pages
    where id = p_id and account_id = v_account_id and deleted_at is null
  ) then
    raise exception 'kb_duplicate_cascade: страница % не найдена', p_id
      using errcode = 'P0002';
  end if;

  -- Position нового root: следом за исходным, чтобы копия
  -- появилась рядом, не в конце списка siblings.
  select parent_id, position + 1
    into v_root_parent, v_root_pos
    from public.kb_pages
   where id = p_id;

  -- Сдвигаем все siblings position >= v_root_pos на +1, чтобы
  -- освободить «дыру» под копию. Без этого копия делила бы position
  -- с уже существующим sibling'ом, и assembleTree (sort by
  -- (position, title)) ставил бы порядок алфавитно, теряя
  -- «сразу после оригинала» инвариант. is not distinct from —
  -- корректно обрабатывает root-уровень (parent_id is null).
  update public.kb_pages
     set position = position + 1
   where account_id = v_account_id
     and parent_id is not distinct from v_root_parent
     and position >= v_root_pos
     and deleted_at is null;

  -- 1) Собираем поддерево (root + все живые потомки) и присваиваем
  --    каждому row'у новый UUID + новый slug. Это mapping для шага 2.
  --    ON CONFLICT по slug маловероятен (~10^-12), но если случится —
  --    PG бросит 23505, upper-level retry'ом не блокируем (caller
  --    может перезапросить duplicate).
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

  -- 2) Insert новых rows. parent_id и position берутся из mapping
  --    (для root — v_root_parent + v_root_pos; для детей — mapping
  --    их оригинального parent + оригинальный position).
  insert into public.kb_pages (
    id, account_id, parent_id, position, title, icon, icon_color,
    slug, content, plain_text, created_by, updated_by
  )
  select
    m.new_id,
    p.account_id,
    case
      when p.id = p_id then v_root_parent  -- root copy лежит рядом с оригиналом
      else (select pm.new_id from _dup_map pm where pm.old_id = p.parent_id)
    end as parent_id,
    case
      when p.id = p_id then v_root_pos  -- root copy сразу после оригинала
      else p.position
    end as position,
    case
      when p.id = p_id then p.title || ' (копия)'  -- root меняем title
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

  -- 3) Pivot kb_page_attachments — копируем ссылки на те же account_files
  --    с полным копированием metadata (caption, attached_by, attached_at).
  --    Storage-объекты НЕ дублируются (shared references), но caption
  --    и audit-attribution принадлежат paged-копии — теряются они
  --    бессмысленно.
  insert into public.kb_page_attachments (
    page_id, file_id, caption, attached_by, attached_at
  )
  select m.new_id, pa.file_id, pa.caption, pa.attached_by, pa.attached_at
    from public.kb_page_attachments pa
    join _dup_map m on m.old_id = pa.page_id;

  -- Backlinks (kb_page_links) и версии (kb_page_versions) намеренно НЕ
  -- копируем. Backlinks пересоберутся на первом save через kb_save_page;
  -- история версий начинается заново.

  select new_id, new_slug
    into v_new_root_id, v_new_root_slug
    from _dup_map
   where old_id = p_id;

  return query select v_new_root_id, v_new_root_slug;
end;
$$;

comment on function public.kb_duplicate_cascade(uuid) is
  'Дублирует страницу + всё поддерево живых потомков. Возвращает '
  '(new_id, new_slug) нового root для redirect. Title корня получает '
  'суффикс « (копия)»; иерархия и attachments сохраняются.';

grant execute on function public.kb_duplicate_cascade(uuid) to authenticated;
grant execute on function public.kb_generate_slug() to authenticated;
