-- Исправление функции init_user_from_auth для вызова обновленной init_user_full_setup
-- Миграция от 03.01.2025

-- Обновляем функцию init_user_from_auth для работы с новой сигнатурой init_user_full_setup
CREATE OR REPLACE FUNCTION public.init_user_from_auth()
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
  -- Получаем ID текущего пользователя из auth
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'No authenticated user found',
      'message', 'Пользователь не аутентифицирован'
    );
  END IF;
  
  -- Получаем email из auth.users
  SELECT email, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', 'Новый пользователь')
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
  
  -- Проверяем, не создан ли уже пользователь
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_auth_user_id) THEN
    RETURN json_build_object(
      'success', FALSE,
      'error', 'User already exists',
      'message', 'Пользователь уже инициализирован',
      'user_id', v_auth_user_id
    );
  END IF;
  
  -- Вызываем основную функцию инициализации (БЕЗ четвертого параметра username)
  SELECT public.init_user_full_setup(v_auth_user_id, v_email, v_full_name)
  INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Также исправляем функцию handle_new_user_signup в webhook
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  webhook_url TEXT;
  payload JSON;
  response_code INTEGER;
BEGIN
  -- Формируем URL для webhook (будет настроен через переменные окружения)
  webhook_url := current_setting('app.settings.signup_webhook_url', true);
  
  -- Если URL не настроен, пытаемся вызвать функцию напрямую
  IF webhook_url IS NULL OR webhook_url = '' THEN
    RAISE LOG 'Signup webhook URL not configured, calling function directly';
    
    -- Вызываем функцию инициализации напрямую (БЕЗ четвертого параметра)
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Новый пользователь')
    );
    
    RETURN NEW;
  END IF;
  
  -- Формируем payload для webhook
  payload := json_build_object(
    'type', 'INSERT',
    'table', 'users',
    'schema', 'auth',
    'record', row_to_json(NEW),
    'old_record', NULL
  );
  
  -- Отправляем webhook (через pg_net если доступен)
  BEGIN
    SELECT net.http_post(
      url := webhook_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := payload::jsonb
    ) INTO response_code;
    
    RAISE LOG 'Signup webhook called with response code: %', response_code;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Failed to call signup webhook: %, calling function directly', SQLERRM;
    
    -- В случае ошибки webhook вызываем функцию напрямую (БЕЗ четвертого параметра)
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Новый пользователь')
    );
  END;
  
  RETURN NEW;
END;
$$;

-- Комментарии
COMMENT ON FUNCTION public.init_user_from_auth IS 'Упрощенная функция инициализации пользователя из auth контекста (исправлена для новой сигнатуры)';
COMMENT ON FUNCTION public.handle_new_user_signup IS 'Триггер-функция для обработки новых регистраций (исправлена для новой сигнатуры)'; 