-- ============================================================
-- 031_quickresto_integration_grants.sql
-- Grants for Quick Resto integration tables
-- ============================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on table public.integration_connections
  to authenticated, service_role;

grant select, insert, update, delete
  on table public.external_entity_links
  to authenticated, service_role;

grant select, insert, update, delete
  on table public.integration_import_runs
  to authenticated, service_role;

grant select, insert, update, delete
  on table public.integration_external_snapshots
  to authenticated, service_role;
