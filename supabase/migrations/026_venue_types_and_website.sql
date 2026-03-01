-- 1. Extend venue_type enum with new values
--    (Postgres allows adding to enums but not removing, so we keep existing ones)
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'snack_bar';    -- Закусочная
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'hookah';       -- Кальянная
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'pastry_shop';  -- Кондитерская
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'coffee_shop';  -- Кофейня
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'pub';          -- Паб
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'pizzeria';     -- Пиццерия
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'canteen';      -- Столовая
ALTER TYPE public.venue_type ADD VALUE IF NOT EXISTS 'fast_food';    -- Фастфуд

-- 2. Add optional website field to venues
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS website text;

-- 3. Recreate RPC to accept p_venue_website
CREATE OR REPLACE FUNCTION public.complete_owner_onboarding(
  p_account_name  text,
  p_account_logo  text,
  p_venue_name    text,
  p_venue_type    public.venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_venue_website text DEFAULT '',
  p_currency      text DEFAULT 'RUB',
  p_timezone      text DEFAULT 'Europe/Moscow',
  p_working_hours jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_account_id    uuid;
  v_venue_id      uuid;
  v_owner_role_id uuid;
BEGIN
  -- Создаём аккаунт
  INSERT INTO public.accounts (name, logo_url, owner_id)
  VALUES (p_account_name, p_account_logo, auth.uid())
  RETURNING id INTO v_account_id;

  -- Создаём первое заведение
  INSERT INTO public.venues (
    account_id, name, type, address, phone, website,
    currency, timezone, working_hours
  )
  VALUES (
    v_account_id, p_venue_name, p_venue_type,
    p_venue_address, p_venue_phone,
    NULLIF(TRIM(p_venue_website), ''),
    p_currency, p_timezone, p_working_hours
  )
  RETURNING id INTO v_venue_id;

  -- Находим системную роль owner
  SELECT id INTO v_owner_role_id
  FROM public.roles
  WHERE code = 'owner' AND account_id IS NULL;

  -- Привязываем владельца к заведению
  INSERT INTO public.user_venue_roles (user_id, venue_id, role_id)
  VALUES (auth.uid(), v_venue_id, v_owner_role_id);

  -- Устанавливаем активное заведение
  UPDATE public.profiles
  SET active_venue_id = v_venue_id
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'account_id', v_account_id,
    'venue_id',   v_venue_id
  );
END;
$$;
