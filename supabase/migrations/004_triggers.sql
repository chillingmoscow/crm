-- ============================================================
-- 004_triggers.sql
-- Триггеры: автосоздание профиля и аккаунта при регистрации
-- ============================================================

-- Триггер: создаёт профиль при появлении нового пользователя в auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Функция для принятия приглашения
-- Вызывается из server action после успешной регистрации по magic link
create or replace function public.accept_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.invitations%rowtype;
begin
  -- Берём приглашение
  select * into v_invitation
  from public.invitations
  where id = p_invitation_id
    and email = (select email from auth.users where id = auth.uid())
    and status = 'pending'
    and expires_at > now();

  if not found then
    raise exception 'Приглашение не найдено или истекло';
  end if;

  -- Создаём связь пользователь-заведение-роль
  insert into public.user_venue_roles (user_id, venue_id, role_id, invited_by)
  values (auth.uid(), v_invitation.venue_id, v_invitation.role_id, v_invitation.invited_by)
  on conflict (user_id, venue_id) do update
    set role_id = excluded.role_id;

  -- Устанавливаем активное заведение, если не задано
  update public.profiles
  set active_venue_id = v_invitation.venue_id
  where id = auth.uid()
    and active_venue_id is null;

  -- Помечаем приглашение принятым
  update public.invitations
  set status = 'accepted'
  where id = p_invitation_id;
end;
$$;

-- Функция для создания аккаунта и заведения при онбординге владельца
create or replace function public.complete_owner_onboarding(
  p_account_name  text,
  p_account_logo  text,
  p_venue_name    text,
  p_venue_type    venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_currency      text,
  p_timezone      text,
  p_working_hours jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_venue_id   uuid;
  v_owner_role_id uuid;
begin
  -- Создаём аккаунт
  insert into public.accounts (name, logo_url, owner_id)
  values (p_account_name, p_account_logo, auth.uid())
  returning id into v_account_id;

  -- Создаём первое заведение
  insert into public.venues (
    account_id, name, type, address, phone,
    currency, timezone, working_hours
  )
  values (
    v_account_id, p_venue_name, p_venue_type,
    p_venue_address, p_venue_phone,
    p_currency, p_timezone, p_working_hours
  )
  returning id into v_venue_id;

  -- Находим системную роль owner
  select id into v_owner_role_id
  from public.roles
  where code = 'owner' and account_id is null;

  -- Привязываем владельца к заведению
  insert into public.user_venue_roles (user_id, venue_id, role_id)
  values (auth.uid(), v_venue_id, v_owner_role_id);

  -- Устанавливаем активное заведение
  update public.profiles
  set active_venue_id = v_venue_id
  where id = auth.uid();

  return jsonb_build_object(
    'account_id', v_account_id,
    'venue_id',   v_venue_id
  );
end;
$$;
