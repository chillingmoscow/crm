-- ============================================================
-- 030_profiles_terminal_pin.sql
-- Terminal PIN imported from Quick Resto employee user.pin
-- ============================================================

alter table public.profiles
  add column if not exists terminal_pin text;
