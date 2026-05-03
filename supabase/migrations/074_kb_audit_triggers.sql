-- ============================================================
-- 074_kb_audit_triggers.sql
-- Sprint C / audit-trail для KB-страниц.
--
-- Зачем: до сих пор audit_logs не покрывал KB. Если страница исчезла /
-- переехала / переименовалась — узнать «кто и когда» можно было только
-- через kb_page_versions (и то только для save-edit'ов). Для compliance
-- (регламенты в ресторане) и debug'а (юзер: «куда делась моя страница?»)
-- нужен полноценный audit-trail.
--
-- Решение: триггер `public.kb_pages_audit_trigger()` пишет в существующий
-- audit_logs (миграция 035) через `log_audit()`. НЕ создаём отдельную
-- таблицу — единый journal удобнее для cross-entity-фильтров и UI.
--
-- Event-types (entity_type='kb_page'):
--   kb_page.created   — INSERT новой страницы
--   kb_page.renamed   — UPDATE OF title (только title; чтобы не шумел
--                       при каждом save'е общий kb_page.edited)
--   kb_page.moved     — UPDATE OF parent_id (cross-parent drag-n-drop)
--   kb_page.deleted   — UPDATE deleted_at NULL → NOT NULL (soft-delete)
--   kb_page.restored  — UPDATE deleted_at NOT NULL → NULL (restore)
--
-- Что НЕ логируется (намеренно):
--   • kb_page.edited (на каждый kb_save_page) — слишком шумно, эта
--     история уже есть в kb_page_versions с полным content snapshot.
--   • Изменения position (sibling reorder) — слишком частые / низкоценные
--     для audit'а; за порядок отвечает UI-state.
--   • Изменения icon/icon_color — visual-only, не security-relevant.
--
-- Read-доступ — через RLS на audit_logs (org.view_audit; миграция 035
-- §RLS). Owner / admin / accountant видят, manager / hostess / waiter
-- — нет.
-- ============================================================

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

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.kb_pages_audit_trigger() is
  'Триггер-функция для audit-trail KB-страниц. Записывает в общий '
  'audit_logs события: created / renamed / moved / deleted / restored. '
  'Save-edit'' ы НЕ логирует (есть kb_page_versions).';

drop trigger if exists kb_pages_audit on public.kb_pages;
create trigger kb_pages_audit
  after insert or update on public.kb_pages
  for each row
  execute function public.kb_pages_audit_trigger();

comment on trigger kb_pages_audit on public.kb_pages is
  'Audit-log триггер. См. kb_pages_audit_trigger().';
