-- ============================================================
-- 096_kb_audit_required_reading_branch.sql
--
-- Расширяет kb_pages_audit_trigger (последняя редакция — миграция 087)
-- веткой на toggle required_reading. До этого при флаге обязательного
-- прочтения никаких audit-event'ов не писалось — compliance-
-- расследование «когда страница стала обязательной» невозможно.
--
-- Sprint D plan §2.7-C: «Audit-event kb_page.required_reading_toggled».
--
-- В отличие от lock-branch (миграция 087), required-reading toggle
-- проходит через server-action setKbPageRequiredReading в auth-context'е
-- юзера → log_audit получает active_account_id корректно. Ветка
-- работоспособна без обходов.
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

    -- Move.
    if OLD.parent_id is distinct from NEW.parent_id then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'old_parent_id', OLD.parent_id,
        'new_parent_id', NEW.parent_id
      );
      perform public.log_audit('kb_page.moved', 'kb_page', NEW.id, v_payload);
    end if;

    -- Rename.
    if OLD.title is distinct from NEW.title then
      v_payload := jsonb_build_object(
        'old_title', OLD.title,
        'new_title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.renamed', 'kb_page', NEW.id, v_payload);
    end if;

    -- NEW (миграция 096): required_reading toggle. Compliance-сигнал —
    -- кто и когда пометил страницу как обязательную к прочтению.
    -- payload включает direction (true/false), чтобы reader audit-feed
    -- мог рендерить как «отметил обязательным» / «снял отметку».
    if OLD.required_reading is distinct from NEW.required_reading then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'old_value', coalesce(OLD.required_reading, false),
        'new_value', coalesce(NEW.required_reading, false)
      );
      perform public.log_audit(
        'kb_page.required_reading_toggled',
        'kb_page',
        NEW.id,
        v_payload
      );
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.kb_pages_audit_trigger() is
  'Триггер-функция для audit-trail KB-страниц. События: created / '
  'renamed / moved / deleted / restored / required_reading_toggled. '
  'Save-edits НЕ логирует — есть kb_page_versions. '
  'Sprint D §2.7-C, миграция 096.';
