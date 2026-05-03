-- ============================================================
-- 080_kb_required_reading_admin.sql
-- Sprint D / Phase 2 — Required-reading admin view + audit fixup.
--
-- Закрывает два пункта из плана system-reminder-…-moonbeam.md:
--   • Раздел 2.7-C — audit-event `kb_page.required_reading_toggled`.
--     Сейчас триггер 074 ловит только title/parent/deleted/restored
--     diff'ы; toggle required_reading проходит как UPDATE без event'а
--     → compliance не может расследовать «когда страница стала
--     обязательной».
--   • Phase 2 — RPC `kb_list_required_reading_stats(p_page_id)` для
--     admin-view: список юзеров active account с `kb.view_pages`
--     permission и их read_at (или NULL если не прочитал). Без RPC
--     пришлось бы делать join на стороне клиента через несколько
--     запросов, что мутировало бы под RLS.
-- ============================================================

-- ============================================================
-- 1. Расширяем kb_pages_audit_trigger веткой required_reading
-- ============================================================
--
-- create or replace function — это полная замена. Копируем тело
-- из 074, добавляем одну ветку. Если бы только ALTER FUNCTION —
-- PG не поддерживает «добавить statement в plpgsql body», только
-- replace целиком.

create or replace function public.kb_pages_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'title', NEW.title,
      'slug', NEW.slug,
      'parent_id', NEW.parent_id
    );
    perform public.log_audit('kb_page.created', 'kb_page', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Soft-delete: NULL → NOT NULL.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'cascaded_root', NEW.deleted_root_id
      );
      perform public.log_audit('kb_page.deleted', 'kb_page', NEW.id, v_payload);
      return NEW;
    end if;

    -- Restore: NOT NULL → NULL.
    if OLD.deleted_at is not null and NEW.deleted_at is null then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.restored', 'kb_page', NEW.id, v_payload);
      return NEW;
    end if;

    -- Move (cross-parent drag-n-drop). Также покрывает root↔nested.
    if OLD.parent_id is distinct from NEW.parent_id then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'old_parent_id', OLD.parent_id,
        'new_parent_id', NEW.parent_id
      );
      perform public.log_audit('kb_page.moved', 'kb_page', NEW.id, v_payload);
      -- Не возвращаем — title могло также измениться, упадём в rename.
    end if;

    -- Rename (title changed). Только если title реально другой —
    -- iconChange/contentChange проходят мимо (там OLD.title=NEW.title).
    if OLD.title is distinct from NEW.title then
      v_payload := jsonb_build_object(
        'old_title', OLD.title,
        'new_title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.renamed', 'kb_page', NEW.id, v_payload);
    end if;

    -- Required-reading toggle. Compliance-критичное событие — owner
    -- помечает регламент «обязательным к прочтению» (или снимает флаг).
    -- Без отдельного event-type'а не было видно из audit-feed'а, когда
    -- именно страница стала / перестала быть обязательной (Раздел 2.7-C).
    if OLD.required_reading is distinct from NEW.required_reading then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'enabled', NEW.required_reading
      );
      perform public.log_audit('kb_page.required_reading_toggled', 'kb_page', NEW.id, v_payload);
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.kb_pages_audit_trigger() is
  'Триггер-функция для audit-trail KB-страниц. Записывает в общий '
  'audit_logs события: created / renamed / moved / deleted / restored / '
  'required_reading_toggled. Save-edit''ы НЕ логирует (есть kb_page_versions).';

-- Триггер уже привязан в 074 (`drop trigger if exists ... + create
-- trigger ...`). Replace function поднимет новое тело автоматически
-- — re-attach не нужен.

-- ============================================================
-- 2. RPC kb_list_required_reading_stats — admin-view «кто прочитал»
-- ============================================================
--
-- Возвращает список юзеров active account с `kb.view_pages` (= тех,
-- кто потенциально должен читать) и их read_at (NULL если ещё не
-- прочитал). Сортировка: сначала прочитавшие (по read_at desc),
-- потом непрочитавшие алфавитно.
--
-- Пул юзеров: те, у кого есть active user_venue_role в venue active
-- account'а (= видны в @-mention picker через kb_list_account_members,
-- миграция 061). Берём оттуда же — единый источник истины «кто живёт
-- в этом account'е».
--
-- Гейт: kb.manage_required_reading (permission, миграция 075). Без
-- него RPC возвращает empty — UI должен сам redirect'ить, но
-- defense in depth.

create or replace function public.kb_list_required_reading_stats(
  p_page_id uuid
)
returns table (
  user_id     uuid,
  first_name  text,
  last_name   text,
  avatar_url  text,
  read_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
begin
  if not public.has_permission('kb.manage_required_reading') then
    -- Возвращаем пустой набор, чтобы UI получил «нет данных» вместо
    -- exception — admin-view UI всё равно должен check'ать permission
    -- редиректом, это страховка.
    return;
  end if;

  -- Sanity: страница должна жить в active account, иначе cross-tenant.
  if not exists (
    select 1 from public.kb_pages
     where id = p_page_id
       and account_id = v_account_id
       and deleted_at is null
  ) then
    return;
  end if;

  return query
  with members as (
    -- Все active-юзеры в venue'ах active account'а (= те, кого
    -- видит @-mention). distinct, потому что юзер может работать
    -- в нескольких venue'ах одного account'а.
    select distinct p.id, p.first_name, p.last_name, p.avatar_url
    from public.profiles p
    join public.user_venue_roles uvr on uvr.user_id = p.id
    join public.venues v on v.id = uvr.venue_id
    where v.account_id = v_account_id
      and uvr.status = 'active'
  )
  select
    m.id            as user_id,
    m.first_name,
    m.last_name,
    m.avatar_url,
    r.read_at
  from members m
  left join public.kb_page_reads r
    on r.user_id = m.id
   and r.page_id = p_page_id
   and r.account_id = v_account_id
  -- Сортировка: прочитавшие первые (latest first), потом непрочитавшие
  -- алфавитно — admin'у важнее увидеть «кто УЖЕ прочитал» сверху.
  order by
    r.read_at desc nulls last,
    m.first_name nulls last,
    m.last_name  nulls last;
end;
$$;

comment on function public.kb_list_required_reading_stats(uuid) is
  'Admin-view «кто прочитал» для KB-страницы. Возвращает всех members '
  'active account и их read_at (NULL если не прочитал). Гейт '
  'kb.manage_required_reading + check page живёт в active account.';

revoke all on function public.kb_list_required_reading_stats(uuid) from public;
grant execute on function public.kb_list_required_reading_stats(uuid) to authenticated;
