-- Исправление автоматической инициализации пользователей
-- Миграция от 03.01.2025 - Настройка триггера на auth.users

-- 1. ОБНОВЛЯЕМ ФУНКЦИЮ ТРИГГЕРА (убираем лишний параметр)
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_full_name TEXT;
  v_result JSON;
BEGIN
  RAISE LOG '🔥 Триггер handle_new_user_signup вызван для: %', NEW.email;
  
  -- Извлекаем полное имя из метаданных
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name', 
    'Новый пользователь'
  );
  
  -- Вызываем инициализацию (БЕЗ 4-го параметра username)
  BEGIN
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      v_full_name
    );
    
    RAISE LOG '✅ Пользователь % успешно инициализирован', NEW.email;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '❌ Ошибка инициализации пользователя %: %', NEW.email, SQLERRM;
    -- НЕ блокируем регистрацию в auth.users
  END;
  
  RETURN NEW;
END;
$$;

-- 2. ФУНКЦИЯ ДЛЯ РУЧНОЙ ИНИЦИАЛИЗАЦИИ ИЗ КЛИЕНТА
CREATE OR REPLACE FUNCTION public.complete_user_registration()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id UUID;
  v_email TEXT;
  v_full_name TEXT;
  v_result JSON;
BEGIN
  -- Получаем ID текущего авторизованного пользователя
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'Not authenticated',
      'message', 'Пользователь не авторизован'
    );
  END IF;
  
  -- Проверяем, не инициализирован ли уже
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_auth_user_id) THEN
    RETURN json_build_object(
      'success', TRUE,
      'message', 'Пользователь уже инициализирован',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Получаем данные из auth.users
  SELECT email, raw_user_meta_data->>'full_name'
  INTO v_email, v_full_name
  FROM auth.users 
  WHERE id = v_auth_user_id;
  
  IF v_email IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'User email not found',
      'message', 'Email пользователя не найден'
    );
  END IF;
  
  -- Вызываем инициализацию
  SELECT public.init_user_full_setup(v_auth_user_id, v_email, v_full_name)
  INTO v_result;
  
  RETURN v_result;
END;
$$;

-- 3. ПОПЫТКА СОЗДАТЬ ТРИГГЕР НА auth.users (если возможно)
DO $$
BEGIN
  -- Пытаемся создать триггер на auth.users
  BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created 
             AFTER INSERT ON auth.users 
             FOR EACH ROW 
             EXECUTE FUNCTION public.handle_new_user_signup()';
    
    RAISE LOG '✅ Триггер на auth.users создан успешно';
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '⚠️ Не удалось создать триггер на auth.users: %', SQLERRM;
    RAISE LOG 'ℹ️ Используйте функцию complete_user_registration() из клиентского кода';
  END;
END $$;

-- 4. ОБНОВЛЯЕМ ФУНКЦИЮ ПРОВЕРКИ СТАТУСА
CREATE OR REPLACE FUNCTION public.check_user_initialization_status()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id UUID;
  v_user_exists BOOLEAN;
  v_org_id UUID;
  v_assignment_exists BOOLEAN;
BEGIN
  -- Получаем ID текущего пользователя
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'error', 'User not authenticated',
      'message', 'Пользователь не авторизован'
    );
  END IF;
  
  -- Проверяем существование пользователя
  SELECT 
    EXISTS(SELECT 1 FROM public.users WHERE id = v_auth_user_id),
    organization_id
  INTO v_user_exists, v_org_id
  FROM public.users 
  WHERE id = v_auth_user_id;
  
  IF NOT v_user_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User not found in public.users',
      'auth_user_id', v_auth_user_id
    );
  END IF;
  
  IF v_org_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no organization',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Проверяем назначения
  SELECT EXISTS(
    SELECT 1 FROM user_assignments 
    WHERE user_id = v_auth_user_id 
      AND is_active = TRUE
      AND accepted_at IS NOT NULL
  ) INTO v_assignment_exists;
  
  IF NOT v_assignment_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no active assignments',
      'user_id', v_auth_user_id,
      'organization_id', v_org_id
    );
  END IF;
  
  RETURN json_build_object(
    'initialized', TRUE,
    'user_id', v_auth_user_id,
    'organization_id', v_org_id,
    'message', 'User fully initialized'
  );
END;
$$;

-- 5. КОММЕНТАРИИ
COMMENT ON FUNCTION public.handle_new_user_signup IS 'Триггер-функция для автоматической инициализации пользователей (исправлена)';
COMMENT ON FUNCTION public.complete_user_registration IS 'Ручная инициализация пользователя из клиентского кода';
COMMENT ON FUNCTION public.check_user_initialization_status IS 'Проверка статуса инициализации текущего пользователя (исправлена)';

-- Успешное завершение
DO $$
BEGIN
  RAISE LOG '🎉 Автоматическая инициализация настроена!';
  RAISE LOG '📝 Если триггер не сработал, используйте complete_user_registration() из клиента';
END $$; 