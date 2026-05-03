-- ============================================================
-- 082_kb_audit_lock.sql
-- Sprint D / Phase 3 — Audit-events для Page Lock.
--
-- Зачем: после миграции 078 страницы можно блокировать. Compliance-
-- расследование «когда страница была закреплена / снова открыта»
-- требует отдельных event-types в audit_logs — toggle locked_at
-- иначе проходит как обычный UPDATE без события.
--
-- ВАЖНО про порядок миграций. Триггер `kb_pages_audit_trigger` уже
-- три раза переписывался:
--   074 — baseline (created/renamed/moved/deleted/restored)
--   080 — добавил `required_reading_toggled`
--   082 — добавляет `locked` / `unlocked`
--
-- Эта миграция намеренно идёт **после** 080. На fresh `pnpm db:reset`
-- порядок: 074 → 080 → 082 — финальное тело включает ВСЕ ветки. Если
-- бы lock-branch был в 078 (раньше 080), то 080's recreate стёр бы
-- lock-логику. Разделение schema (078) и audit-trigger (082) сохраняет
-- эту инвариантность.
--
-- На прод порядок применения такой же: 080 уже накачан в Phase 2,
-- 078 + 082 пушим в Phase 3.
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

    -- Rename (title changed).
    if OLD.title is distinct from NEW.title then
      v_payload := jsonb_build_object(
        'old_title', OLD.title,
        'new_title', NEW.title,
        'slug', NEW.slug
      );
      perform public.log_audit('kb_page.renamed', 'kb_page', NEW.id, v_payload);
    end if;

    -- Required-reading toggle (миграция 080).
    if OLD.required_reading is distinct from NEW.required_reading then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'enabled', NEW.required_reading
      );
      perform public.log_audit('kb_page.required_reading_toggled', 'kb_page', NEW.id, v_payload);
    end if;

    -- Lock toggle (миграция 082, Sprint D Phase 3).
    -- Compliance-важное действие — admin закрепляет регламент как
    -- готовый. Отдельный event-type, чтобы фильтровать в audit-feed'е
    -- «кто и когда закрепил/раз-закрепил».
    if (OLD.locked_at is null) is distinct from (NEW.locked_at is null) then
      v_payload := jsonb_build_object(
        'title', NEW.title,
        'slug', NEW.slug,
        'locked', NEW.locked_at is not null
      );
      perform public.log_audit(
        case
          when NEW.locked_at is not null then 'kb_page.locked'
          else 'kb_page.unlocked'
        end,
        'kb_page', NEW.id, v_payload
      );
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.kb_pages_audit_trigger() is
  'Триггер-функция для audit-trail KB-страниц. Записывает в общий '
  'audit_logs события: created / renamed / moved / deleted / restored / '
  'required_reading_toggled / locked / unlocked. Save-edit''ы НЕ логирует '
  '(есть kb_page_versions).';

-- Триггер уже привязан в 074 (`drop trigger if exists ... + create
-- trigger ...`). Replace function поднимает новое тело автоматически.
