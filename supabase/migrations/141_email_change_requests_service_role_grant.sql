-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 141_email_change_requests_service_role_grant.sql
--
-- Hotfix для миграции 139: таблица email_change_requests была создана
-- через supabase_admin SSH-flow, ALTER DEFAULT PRIVILEGES из 047 выдало
-- грaнты только anon + authenticated, а service_role остался без INSERT/
-- UPDATE/SELECT. Server-action `requestEmailChange` ходит admin-клиентом
-- (service_role JWT) и падает с «permission denied for table
-- email_change_requests».
--
-- См. memory `self_hosted_supabase.md` про этот класс багов.
-- ─────────────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.email_change_requests
  to service_role;
