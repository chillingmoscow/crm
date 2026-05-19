-- ============================================================
-- 197_user_venue_roles_role_id_cascade.sql
-- Фикс: удаление заведения падало
--   «update or delete on table "roles" violates foreign key
--    constraint user_venue_roles_role_id_fkey»
-- Цепочка: venues delete → roles.venue_id CASCADE (venue-scoped роли
-- удаляются) → user_venue_roles.role_id ON DELETE RESTRICT блокирует.
-- Семантика: удалили роль → членства по ней теряют смысл, должны
-- удалиться вместе. Меняем FK на ON DELETE CASCADE.
-- ============================================================

alter table public.user_venue_roles
  drop constraint user_venue_roles_role_id_fkey;

alter table public.user_venue_roles
  add constraint user_venue_roles_role_id_fkey
  foreign key (role_id) references public.roles(id) on delete cascade;
