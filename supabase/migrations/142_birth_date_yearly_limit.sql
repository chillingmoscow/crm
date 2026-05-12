-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 142_birth_date_yearly_limit.sql
--
-- Юзер может менять дату рождения не чаще, чем раз в год. Это защита
-- от фрода с поздравлениями/подарками: иначе кто-то может выставить
-- сегодня ДР, получить поздравление, потом перевыставить через месяц
-- и снова получить.
--
-- Реализация: BEFORE UPDATE trigger на profiles. Если новое значение
-- birth_date отличается от старого, и последнее изменение было < года
-- назад — raise exception. Триггер пропускает service_role и
-- supabase_admin'а (HR/админам нужно править ошибки сотрудников).
--
-- Идемпотентность: ON CONFLICT не применима к функциям/триггерам —
-- используем `create or replace function` + `drop trigger if exists`.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.tg_profiles_birth_date_yearly_limit()
returns trigger
language plpgsql
as $$
declare
  v_current_role text := current_user;
begin
  -- Service-role / superuser обходят: HR может править через
  -- админ-инструменты или скрипты. Эта проверка — только для
  -- self-service через `authenticated`-сессию.
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

  -- Уже была дата, юзер хочет поменять. Проверяем — давно ли
  -- последнее изменение. birth_date_set_at заполняется триггером
  -- tg_profiles_track_birth_date (см. миграцию 132).
  if old.birth_date_set_at is not null
     and old.birth_date_set_at > now() - interval '1 year' then
    raise exception 'Дату рождения можно менять не чаще раза в год. Последнее изменение: %',
      to_char(old.birth_date_set_at, 'DD.MM.YYYY');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_birth_date_yearly_limit on public.profiles;
create trigger trg_profiles_birth_date_yearly_limit
  before update on public.profiles
  for each row execute function public.tg_profiles_birth_date_yearly_limit();

-- Порядок триггеров: yearly_limit ДО track (т.к. limit смотрит на
-- старый birth_date_set_at; track обновляет его). Postgres'овский
-- порядок — alphabetical-по-имени; trg_profiles_birth_date (track,
-- из 132) < trg_profiles_birth_date_yearly_limit (limit) — track
-- бежит раньше, но он работает с NEW.birth_date_set_at = now(),
-- yearly_limit смотрит на OLD.birth_date_set_at — это разные
-- переменные, конфликта нет.
