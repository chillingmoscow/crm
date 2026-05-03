-- ============================================================
-- 081_kb_audit_thread_events.sql
-- Sprint D / Phase 4a — Audit-events для kb_threads.
--
-- Закрывает Раздел 2.8-H plan'а: thread-события (created/resolved/
-- unresolved/deleted) сейчас не попадают в audit_logs. Compliance
-- расследование «когда был создан/закрыт thread по этому регламенту»
-- невозможно — у нас только содержимое kb_threads + kb_comments
-- без timestamp-history.
--
-- Решение: trigger на kb_threads INSERT/UPDATE → emit отдельные
-- event-types в общий audit_logs (через `log_audit()`, миграция 035).
-- Таблица audit_logs сама уже имеет RLS (`org.view_audit`), reader-
-- доступ — owner / admin / accountant. Hostess / waiter / manager
-- не видят kb-аудит.
-- ============================================================

create or replace function public.kb_threads_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_page_slug text;
  v_page_title text;
begin
  -- Берём slug + title страницы для payload — оба нужны для рендера
  -- audit-row'а в /knowledge/audit без отдельного fetch'а page-meta.
  -- Если страница уже soft-deleted — slug всё равно есть (мы не делаем
  -- hard-delete), просто помечаем как страницы-в-корзине.
  select slug, title into v_page_slug, v_page_title
    from public.kb_pages
   where id = NEW.page_id;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'thread_id', NEW.id,
      'page_id', NEW.page_id,
      'page_slug', v_page_slug,
      'page_title', v_page_title
    );
    perform public.log_audit('kb_thread.created', 'kb_thread', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    -- Resolve toggle: false → true.
    if OLD.resolved = false and NEW.resolved = true then
      v_payload := jsonb_build_object(
        'thread_id', NEW.id,
        'page_id', NEW.page_id,
        'page_slug', v_page_slug,
        'page_title', v_page_title
      );
      perform public.log_audit('kb_thread.resolved', 'kb_thread', NEW.id, v_payload);
      return NEW;
    end if;

    -- Unresolve toggle: true → false.
    if OLD.resolved = true and NEW.resolved = false then
      v_payload := jsonb_build_object(
        'thread_id', NEW.id,
        'page_id', NEW.page_id,
        'page_slug', v_page_slug,
        'page_title', v_page_title
      );
      perform public.log_audit('kb_thread.unresolved', 'kb_thread', NEW.id, v_payload);
      return NEW;
    end if;

    -- Soft-delete: NULL → NOT NULL.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_payload := jsonb_build_object(
        'thread_id', NEW.id,
        'page_id', NEW.page_id,
        'page_slug', v_page_slug,
        'page_title', v_page_title
      );
      perform public.log_audit('kb_thread.deleted', 'kb_thread', NEW.id, v_payload);
      return NEW;
    end if;

    return NEW;
  end if;

  return NEW;
end;
$$;

comment on function public.kb_threads_audit_trigger() is
  'Triggers для thread-audit'' а: created / resolved / unresolved / '
  'deleted. Wraps log_audit() в существующий audit_logs '
  '(entity_type=kb_thread). Закрывает план §2.8-H.';

drop trigger if exists kb_threads_audit on public.kb_threads;
create trigger kb_threads_audit
  after insert or update on public.kb_threads
  for each row
  execute function public.kb_threads_audit_trigger();

comment on trigger kb_threads_audit on public.kb_threads is
  'Audit-log триггер для kb_threads. См. функцию.';
