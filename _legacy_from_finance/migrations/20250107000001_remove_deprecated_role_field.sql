-- Удаление устаревшего поля role из таблицы users
-- Теперь роли управляются через таблицу user_assignments и positions

-- Удаляем ограничение CHECK для поля role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Удаляем поле role
ALTER TABLE users DROP COLUMN IF EXISTS role;

-- Комментарий для истории
COMMENT ON TABLE users IS 'Таблица пользователей. Роли теперь управляются через user_assignments и positions.'; 