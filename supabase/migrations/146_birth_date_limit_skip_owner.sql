-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 146_birth_date_limit_skip_owner.sql
--
-- tg_profiles_birth_date_yearly_limit (миграция 142) бесшумно блокирует
-- частые смены birth_date — это анти-фрод для рядовых сотрудников
-- (защита от «выставил ДР сегодня, получил поздравление, потом сменил
-- через месяц и снова получил»). Но владельцы и админы не играют в
-- эту игру с собой — и им нужно иметь возможность спокойно править
-- свою дату (например, когда в первый раз заполняют профиль вместе
-- с тестами).
--
-- Пропускаем гард для юзеров с активным UVR'ом owner-роли в ЛЮБОМ
-- venue текущего аккаунта. Anti-фрод смысл сохраняется для всех
-- остальных.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_profiles_birth_date_yearly_limit()
returns trigger
language plpgsql
as $$
declare
  v_current_role text := current_user;
  v_is_owner boolean;
begin
  -- Service-role / superuser обходят: HR может править через
  -- админ-инструменты или скрипты.
  if v_current_role in ('service_role', 'supabase_admin', 'postgres') then
    return new;
  end if;

  -- Если birth_date не меняется — проверка не нужна.
  if new.birth_date is not distinct from old.birth_date then
    return new;
  end if;

  -- Первое заполнение (раньше было null) — разрешаем.
  if old.birth_date is null then
    return new;
  end if;

  -- Owner / admin аккаунта обходят limit. Анти-фрод нужен только
  -- для рядовых сотрудников.
  select exists (
    select 1
    from public.user_venue_roles uvr
    join public.roles r on r.id = uvr.role_id
    where uvr.user_id = new.id
      and uvr.status  = 'active'
      and r.code in ('owner', 'admin')
  ) into v_is_owner;

  if v_is_owner then
    return new;
  end if;

  -- Уже была дата, юзер хочет поменять — проверяем годичный гард.
  if old.birth_date_set_at is not null
     and old.birth_date_set_at > now() - interval '1 year' then
    raise exception 'Дату рождения можно менять не чаще раза в год. Последнее изменение: %',
      to_char(old.birth_date_set_at, 'DD.MM.YYYY');
  end if;

  return new;
end;
$$;
