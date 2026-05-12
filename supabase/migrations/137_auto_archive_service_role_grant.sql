-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 137_auto_archive_service_role_grant.sql
--
-- Hotfix для миграции 099: `revoke all ... from public` лишал execute
-- роли `service_role`, которой ходит cron-эндпоинт `/api/cron/auto-archive-
-- notifications` (через admin-клиент с service-role-JWT). В итоге cron в
-- проде падал в 500 со скрытой ошибкой «permission denied for function
-- auto_archive_old_notifications».
--
-- Pattern совпадает с тем, что в миграции 135 для
-- enqueue_medical_book_expiry_notifications — service_role-only execute.
-- ─────────────────────────────────────────────────────────────────────────────

grant execute on function public.auto_archive_old_notifications() to service_role;
