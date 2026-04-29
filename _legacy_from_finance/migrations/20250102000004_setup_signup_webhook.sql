-- Настройка webhook для автоматической инициализации пользователей
-- Миграция от 02.01.2025

-- Создаем функцию-триггер для вызова Edge Function при создании пользователя в auth.users
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
    
    -- Вызываем функцию инициализации напрямую
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Новый пользователь'),
      NULL
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
    
    -- В случае ошибки webhook вызываем функцию напрямую
    PERFORM public.init_user_full_setup(
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Новый пользователь'),
      NULL
    );
  END;
  
  RETURN NEW;
END;
$$;

-- Создаем триггер на таблицу auth.users
-- Примечание: этот триггер работает только если у нас есть доступ к схеме auth
-- В production нужно будет настроить webhook через Supabase Dashboard

-- Альтернативное решение: создаем функцию для ручного вызова после регистрации
CREATE OR REPLACE FUNCTION public.complete_user_registration()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Эта функция вызывается из клиентского кода после успешной регистрации
  v_result := public.init_user_from_auth();
  
  RETURN v_result;
END;
$$;

-- Функция для проверки статуса инициализации пользователя
CREATE OR REPLACE FUNCTION public.check_user_initialization_status()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id UUID;
  v_user_exists BOOLEAN;
  v_org_id UUID;
  v_result JSON;
BEGIN
  -- Получаем ID текущего пользователя
  v_auth_user_id := auth.uid();
  
  IF v_auth_user_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'error', 'User not authenticated'
    );
  END IF;
  
  -- Проверяем существование пользователя и его организации
  SELECT 
    EXISTS(SELECT 1 FROM public.users WHERE id = v_auth_user_id),
    organization_id
  INTO v_user_exists, v_org_id
  FROM public.users 
  WHERE id = v_auth_user_id;
  
  IF NOT v_user_exists THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User not found in public.users'
    );
  END IF;
  
  IF v_org_id IS NULL THEN
    RETURN json_build_object(
      'initialized', FALSE,
      'message', 'User has no organization'
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

-- Создаем RPC функции для клиентского доступа
COMMENT ON FUNCTION public.complete_user_registration IS 'Завершает регистрацию пользователя - вызывается из клиентского кода';
COMMENT ON FUNCTION public.check_user_initialization_status IS 'Проверяет статус инициализации текущего пользователя';
COMMENT ON FUNCTION public.handle_new_user_signup IS 'Триггер-функция для обработки новых регистраций'; 