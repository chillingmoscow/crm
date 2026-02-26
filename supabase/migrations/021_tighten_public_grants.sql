-- ============================================================
-- 021_tighten_public_grants.sql
-- Minimize runtime grants for anon/authenticated in public schema
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;
revoke create on schema public from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

revoke all on all routines in schema public from anon, authenticated;
grant execute on all routines in schema public to anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;

alter default privileges in schema public revoke all on routines from anon, authenticated;
alter default privileges in schema public grant execute on routines to anon, authenticated;
