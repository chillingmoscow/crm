-- ============================================================
-- 002_seed_roles_permissions.sql
-- Начальные данные: системные роли и права платформы
-- ============================================================

-- Системные роли (account_id = null)
insert into public.roles (id, account_id, name, code) values
  ('00000000-0000-0000-0000-000000000001', null, 'Владелец',    'owner'),
  ('00000000-0000-0000-0000-000000000002', null, 'Управляющий', 'manager'),
  ('00000000-0000-0000-0000-000000000003', null, 'Администратор','admin'),
  ('00000000-0000-0000-0000-000000000004', null, 'Хостес',      'hostess'),
  ('00000000-0000-0000-0000-000000000005', null, 'Официант',    'waiter');

-- Права платформы
insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000001', 'platform.manage_account',  'Управление аккаунтом',              'platform'),
  ('10000000-0000-0000-0000-000000000002', 'platform.manage_venues',   'Создание и редактирование заведений','platform'),
  ('10000000-0000-0000-0000-000000000003', 'platform.manage_staff',    'Управление сотрудниками',           'platform'),
  ('10000000-0000-0000-0000-000000000004', 'platform.manage_roles',    'Управление ролями и правами',       'platform'),
  ('10000000-0000-0000-0000-000000000005', 'platform.view_analytics',  'Просмотр аналитики',               'platform'),
  ('10000000-0000-0000-0000-000000000006', 'platform.manage_settings', 'Настройки заведения',              'platform');

-- Матрица прав (согласно спеке)
-- owner: все права
insert into public.role_permissions (role_id, permission_id, granted)
select
  '00000000-0000-0000-0000-000000000001',
  id,
  true
from public.permissions where module = 'platform';

-- manager: manage_staff, view_analytics, manage_settings
insert into public.role_permissions (role_id, permission_id, granted) values
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', true),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005', true),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000006', true);

-- admin: view_analytics
insert into public.role_permissions (role_id, permission_id, granted) values
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000005', true);

-- hostess, waiter: нет прав платформы (строки не нужны, has_permission вернёт false)
