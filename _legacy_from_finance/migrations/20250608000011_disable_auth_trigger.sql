-- ОТКЛЮЧЕНИЕ АВТОМАТИЧЕСКОГО ТРИГГЕРА
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
