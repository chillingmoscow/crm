-- ============================================================
-- 087_kb_audit_drop_lock_branch.sql
-- Bugfix Sprint — drop lock-audit branch from kb_pages_audit_trigger.
--
-- Зачем: ветка `kb_page.locked` / `kb_page.unlocked` (миграция 082) на
-- проде не пишет события в audit_logs (вероятно `log_audit` не находит
-- active_account_id из-за security-definer контекста `kb_set_page_lock`).
-- Юзер: «один хрен не работает, можно убрать».
--
-- Решение: re-create trigger function без lock-branch'а. Файл 082
-- удалён из migrations/, эта миграция фиксирует прод. На fresh db:reset
-- порядок будет: 074 → 080 → 087 — финальное тело без lock-логики.
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
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'cascaded_root', NEW.deleted_root_id
      );
      perform public.log_audit('kb_page.deleted', 'kb_page', NEW.id, v_payload);
      return NEW;
    end if;

    if OLD.deleted_at is not null and NEW.deleted_at is null then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.restored', 'kb_page', NEW.id, v_payload);
      return NEW;
    end if;

    if OLD.parent_id is distinct from NEW.parent_id then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'old_parent_id', OLD.parent_id,
        'new_parent_id', NEW.parent_id
      );
      perform public.log_audit('kb_page.moved', 'kb_page', NEW.id, v_payload);
    end if;

    if OLD.title is distinct from NEW.title then
      v_payload := jsonb_build_object(
        'old_title', OLD.title,
        'new_title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.renamed', 'kb_page', NEW.id, v_payload);
    end if;

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
  'Триггер-функция для audit-trail KB-страниц. С 087 — без lock/unlock '
  'event-ов: они на проде не работали, и compliance-ценность '
  '«закрепил/раскрепил регламент» оказалась некритична.';
