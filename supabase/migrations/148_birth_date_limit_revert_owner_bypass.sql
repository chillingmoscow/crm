-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 148_birth_date_limit_revert_owner_bypass.sql
--
-- Откатываем owner/admin-bypass из миграции 146. Причина — путаница в
-- root-cause диагностике: я добавил bypass думая что trigger 142
-- блокировал юзера в его тестах, но на самом деле data-strip симптом
-- был от другого (service_role grants — миграция 147). А trigger 142
-- пропускал смены из-за legacy-пустых birth_date_set_at, не из-за
-- логики bypass'а.
--
-- Возвращаем оригинальное поведение из 142 — limit действует для всех
-- non-superuser ролей. Anti-фрод единый, без owner-исключений: даже
-- владелец не должен иметь возможность бесшумно играть с ДР, потому
-- что подпись «изменено DD.MM.YYYY» покажется коллегам и социально
-- задерживает фрод.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_profiles_birth_date_yearly_limit()
returns trigger
language plpgsql
as $$
declare
  v_current_role text := current_user;
begin
  -- Service-role / superuser обходят: HR/админ-скрипты могут править
  -- через прямой DB-доступ. Эта проверка — только для self-service
  -- через `authenticated`-сессию.
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

  -- Уже была дата, юзер хочет поменять — проверяем годичный гард.
  -- birth_date_set_at заполняется триггером tg_profiles_track_birth_date
  -- (миграция 132). Для legacy-юзеров, чей birth_date был выставлен
  -- ДО миграции 132, set_at = NULL, и первая смена пропускается без
  -- ограничения (а заполняет set_at — следующая уже будет проверяться).
  if old.birth_date_set_at is not null
     and old.birth_date_set_at > now() - interval '1 year' then
    raise exception 'Дату рождения можно менять не чаще раза в год. Последнее изменение: %',
      to_char(old.birth_date_set_at, 'DD.MM.YYYY');
  end if;

  return new;
end;
$$;
