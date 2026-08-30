-- Контекст сессии считается один раз на запрос, а не в каждой политике.
--
-- ── Что не так сейчас ───────────────────────────────────────────────────────
--
-- Миграция 236 вынесла вызовы helper-функций в InitPlan: теперь они выполняются
-- один раз на запрос, а не на каждую строку. Но этот «один раз» всё ещё платит
-- каждый запрос, и стоит он дорого, потому что helper-функции выводят одни и те
-- же факты заново:
--
--   has_permission(код)  = join user_venue_roles × role_permissions × permissions,
--                          плюс внутри ещё вызов get_active_venue_id()
--   get_active_venue_id()= join profiles × venues + exists по user_venue_roles
--
-- Замер на проде (1000 повторов, аргумент зависит от строки, чтобы Postgres не
-- вынес вызов): has_permission — 0,69 мс, get_active_account_id — 0,13 мс.
-- В предикатах 153 политик схемы public эти вызовы встречаются десятками, и
-- каждый отдельный код права даёт свой InitPlan.
--
-- Отсюда пол в несколько миллисекунд, который платит любой запрос независимо от
-- числа строк: на проде `select count(*)` по таблице из трёх строк занимал
-- столько же, сколько по таблице из 51.
--
-- ── Что делаем ──────────────────────────────────────────────────────────────
--
-- PostgREST умеет вызывать функцию сразу после начала транзакции запроса и
-- после установки роли и JWT-claims (`db-pre-request`). Считаем в ней контекст
-- один раз и кладём в транзакционные GUC, а helper-функции учим их читать.
--
-- 153 политики при этом НЕ трогаем — меняются только тела трёх функций.
--
-- ── Замер на локальной базе (прогретые буферы, одна сессия) ─────────────────
--
--   один вызов has_permission          0,205 мс  →  0,014 мс   (в 14 раз)
--   запрос страницы (джойн 3 таблиц)    7,5 мс   →   5,4 мс
--   сам pre-request (200 вызовов)                   0,18 мс
--
-- То есть pre-request стоит примерно как один вызов has_permission и окупается
-- на любом запросе, где прав проверяется больше одного. На тривиальном запросе
-- к одной таблице возможен проигрыш около 0,1 мс — это осознанный размен.
--
-- ── Почему это безопасно ────────────────────────────────────────────────────
--
--  * `set_config(..., true)` — значение живёт только внутри транзакции. Без
--    `true` оно пережило бы возврат соединения в пул и утекло бы следующему
--    пользователю. Это здесь главный инвариант.
--  * Функция лежит в схеме `private`, которой нет в `PGRST_DB_SCHEMAS`, поэтому
--    её нельзя дёрнуть как обычный RPC. Впрочем, даже вызов ничего не даёт:
--    она считает контекст того, кто её вызвал.
--  * Маркер `app.ctx_ready` отделяет «контекст посчитан, прав нет» от
--    «контекст не считался». Без него пустой набор прав был бы неотличим от
--    незаполненного кэша. Сверяем именно с '1', а не через `is not null`:
--    после завершения транзакции GUC, выставленный локально, возвращается к
--    пустой строке, а не к NULL, — и `is not null` считал бы кэш заполненным
--    в следующей транзакции того же соединения.
--  * Если маркера нет — функции идут прежним путём, слово в слово. Это не
--    подстраховка «на всякий случай», а рабочий сценарий: Storage и Realtime
--    ходят в базу мимо PostgREST, как и psql при миграциях.
--
-- Пока у сервиса `supabase-rest` не выставлен `PGRST_DB_PRE_REQUEST`, миграция
-- ничего не меняет: маркер никто не ставит, работает прежняя ветка.

-- ── Схема для того, что не должно быть видно снаружи ────────────────────────

create schema if not exists private;

grant usage on schema private to authenticated, anon, service_role;

-- ── Расчёт контекста ────────────────────────────────────────────────────────

create or replace function private.pgrst_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_venue   uuid;
  v_account uuid;
  v_perms   text;
begin
  -- Анонимный запрос: контекст не считаем и маркер не ставим, чтобы политики
  -- пошли прежним путём.
  if auth.uid() is null then
    return;
  end if;

  -- Тот же отбор, что и в get_active_venue_id / get_active_account_id:
  -- активное заведение засчитывается, только если оно не в архиве и у
  -- пользователя есть в нём активная роль.
  select p.active_venue_id, v.account_id
    into v_venue, v_account
    from public.profiles p
    join public.venues v on v.id = p.active_venue_id
   where p.id = auth.uid()
     and v.archived_at is null
     and exists (
       select 1
         from public.user_venue_roles uvr
        where uvr.user_id = auth.uid()
          and uvr.venue_id = p.active_venue_id
          and uvr.status = 'active'
     );

  -- Права одной строкой в запятых с обеих сторон: `,a.b,c.d,`. Поиск через
  -- strpos дешевле разбора jsonb, а запятых в кодах прав не бывает. Обрамление
  -- с двух сторон не даёт `inventory.view` совпасть с `inventory.view_all`.
  select ',' || coalesce(string_agg(distinct pm.code, ',' order by pm.code), '') || ','
    into v_perms
    from public.user_venue_roles uvr
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions pm on pm.id = rp.permission_id
   where uvr.user_id = auth.uid()
     and uvr.venue_id = v_venue
     and uvr.status = 'active'
     and rp.granted = true;

  perform set_config('app.venue_id',   coalesce(v_venue::text, ''),   true);
  perform set_config('app.account_id', coalesce(v_account::text, ''), true);
  perform set_config('app.perms',      coalesce(v_perms, ',,'),       true);
  perform set_config('app.ctx_ready',  '1',                           true);
end
$fn$;

grant execute on function private.pgrst_pre_request() to authenticated, anon, service_role;

-- ── Helper-функции: читают кэш, иначе прежний путь ──────────────────────────
--
-- Ветка else во всех трёх — дословно прежнее тело. CASE в SQL вычисляет ветки
-- лениво, поэтому при заполненном кэше запросы к таблицам не выполняются.
--
-- SET search_path обязателен в каждом теле: CREATE OR REPLACE сбрасывает все
-- атрибуты, не перечисленные заново (прецедент — миграции 166/172 и фиксап 174).

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    when current_setting('app.ctx_ready', true) = '1'
      -- coalesce на случай, которого быть не должно: app.perms выставляется
      -- раньше маркера, но возвращать NULL вместо false из предиката политики
      -- не стоит даже теоретически.
      then strpos(coalesce(current_setting('app.perms', true), ',,'), ',' || permission_code || ',') > 0
    else exists (
      select 1
      from public.user_venue_roles uvr
      join public.role_permissions rp on rp.role_id = uvr.role_id
      join public.permissions p on p.id = rp.permission_id
      where uvr.user_id  = auth.uid()
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
        and p.code       = permission_code
        and rp.granted   = true
    )
  end
$fn$;

create or replace function public.get_active_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    when current_setting('app.ctx_ready', true) = '1'
      then nullif(current_setting('app.account_id', true), '')::uuid
    else (
      select v.account_id
        from public.profiles p
        join public.venues v on v.id = p.active_venue_id
       where p.id = auth.uid()
         and v.archived_at is null
         and exists (
           select 1
             from public.user_venue_roles uvr
            where uvr.user_id = auth.uid()
              and uvr.venue_id = p.active_venue_id
              and uvr.status = 'active'
         )
    )
  end
$fn$;

create or replace function public.get_active_venue_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select case
    when current_setting('app.ctx_ready', true) = '1'
      then nullif(current_setting('app.venue_id', true), '')::uuid
    else (
      select p.active_venue_id
        from public.profiles p
        join public.venues v on v.id = p.active_venue_id
       where p.id = auth.uid()
         and v.archived_at is null
         and exists (
           select 1
             from public.user_venue_roles uvr
            where uvr.user_id = auth.uid()
              and uvr.venue_id = p.active_venue_id
              and uvr.status = 'active'
         )
    )
  end
$fn$;
