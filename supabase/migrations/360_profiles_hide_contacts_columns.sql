-- ============================================================
-- profiles: телефон, Telegram, дату рождения и адрес нельзя прочитать
-- напрямую через API.
--
-- Политика profiles_select открывает строки коллег по заведению — имя и
-- аватар нужны везде (журналы, база знаний, график). Фактически строки коллег
-- видит тот, кто видит их user_venue_roles, то есть с people.view_staff.
-- RLS построчный, поэтому вместе со строкой открывались и контакты:
-- `from("profiles").select("phone, telegram_id, birth_date, address")` из
-- браузера отдавал их роли, у которой есть список сотрудников, но нет права
-- на их личные данные (people.view_staff_details). Миграция 359 закрыла это
-- в RPC get_venue_staff, здесь — прямой путь. Заодно это страховка на случай,
-- если видимость user_venue_roles когда-нибудь расширят.
--
-- Решение — привилегии на колонки: у anon/authenticated отзываем SELECT на
-- таблицу и выдаём его на все колонки, кроме четырёх. Список «все, кроме»
-- считается при применении, чтобы не зависеть от расхождений схем локально и
-- на проде.
--
-- Кто читает эти поля после миграции:
--   * свой профиль (/profile, онбординг, приглашение) — сервер, admin-клиент
--     по user.id из проверенной сессии;
--   * карточка сотрудника — admin-клиент за проверкой people.view_staff +
--     people.view_staff_details (так было и раньше);
--   * список сотрудников и график — RPC get_venue_staff (миграция 359);
--   * security definer функции, триггеры, cron — от имени владельца, их это
--     не касается.
--
-- Пол оставлен открытым: журнал действий читает его у автора записи для
-- согласования («изменил» / «изменила»), это не контакт.
--
-- Запись не меняется: UPDATE/INSERT на эти колонки по-прежнему разрешены
-- (свой профиль; профиль коллеги — по политике profiles_update с
-- people.edit_staff). PostgREST по умолчанию не возвращает строку после
-- записи, а `.select("id")` после update читает только id.
--
-- ВАЖНО на будущее: новая колонка profiles НЕ станет читаемой для
-- authenticated автоматически — в миграции, которая её добавляет, нужен
-- `grant select (<колонка>) on public.profiles to anon, authenticated`.
-- `select("*")` по profiles из пользовательского клиента теперь падает с
-- permission denied.
--
-- Применять ПОСЛЕ деплоя кода из того же PR: старый код читает свой телефон
-- пользовательским клиентом и без деплоя «Профиль» и онбординг сломаются.
-- ============================================================

begin;

do $$
declare
  hidden constant text[] := array['phone', 'telegram_id', 'birth_date', 'address'];
  visible text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into visible
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> all (hidden);

  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', visible);
end $$;

commit;
