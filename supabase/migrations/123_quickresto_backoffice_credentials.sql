-- ============================================================
-- 123_quickresto_backoffice_credentials.sql
-- Quick Resto back-office bot credentials and session cache
-- ============================================================

alter table public.integration_connections
  add column if not exists backoffice_base_url text,
  add column if not exists backoffice_login text,
  add column if not exists backoffice_password_encrypted text,
  add column if not exists backoffice_password_iv text,
  add column if not exists backoffice_password_tag text,
  add column if not exists backoffice_cookie_encrypted text,
  add column if not exists backoffice_cookie_iv text,
  add column if not exists backoffice_cookie_tag text,
  add column if not exists backoffice_cookie_fetched_at timestamptz,
  add column if not exists backoffice_last_tested_at timestamptz,
  add column if not exists quickresto_bot_role_external_id text,
  add column if not exists quickresto_bot_employee_external_id text;
