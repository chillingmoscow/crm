-- ============================================================
-- 099_notifications_auto_archive_fn.sql
--
-- Функция auto_archive_old_notifications() — архивирует прочитанные
-- нотификации старше 30 дней. Вызывается периодически (раз в сутки)
-- внешним cron'ом. На self-hosted Supabase pg_cron extension не
-- установлен, поэтому wiring scheduling — через системный crontab
-- на проде (psql -c вызов) или через Coolify cron-task.
--
-- Возвращает count архивированных rows для логирования / мониторинга.
-- Idempotent — повторный вызов в течение того же сутки лишь
-- обработает совсем свежие read'ы которые уже подходят под 30-day-old
-- horizon.
--
-- Sprint E §1, миграция 099.
-- ============================================================

create or replace function public.auto_archive_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Архивируем все прочитанные старше 30 дней. WHERE archived_at IS NULL
  -- предотвращает повторную архивацию.
  with archived as (
    update public.notifications
       set archived_at = now()
     where read = true
       and archived_at is null
       and created_at < now() - interval '30 days'
    returning id
  )
  select count(*) into v_count from archived;

  return v_count;
end;
$$;

comment on function public.auto_archive_old_notifications() is
  'Архивирует прочитанные нотификации старше 30 дней. Вызывается раз в '
  'сутки внешним cron''ом (системный crontab или Coolify schedule). '
  'Возвращает count архивированных. Sprint E §1, миграция 099.';

-- Только service-role / сам вызывает (прямой grant НЕ даём
-- authenticated — это admin/cron-only).
revoke all on function public.auto_archive_old_notifications() from public;
