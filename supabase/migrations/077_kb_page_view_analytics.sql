-- ============================================================
-- 077_kb_page_view_analytics.sql
-- Sprint D / Phase 1 — Page-time analytics.
--
-- Зачем: до сих пор мы видим только бинарное «прочитано / не прочитано»
-- через kb_page_reads (миграция 075) и audit_logs (74). Нет ответа на
-- вопросы:
--   • Сколько времени Иван провёл на этом регламенте?
--   • Какие страницы реально читают, а какие лежат «для галочки»?
--   • Топ-юзер по активности в KB на этой неделе?
--
-- Решение: continuous time-tracking через client-heartbeat.
-- Клиент в `useKbPageViewTracker` пингует каждые 30с пока вкладка
-- visible + есть активность (mouse/keyboard/scroll). На unmount /
-- visibilitychange='hidden' / beforeunload — flush сессию через
-- RPC `kb_record_page_view`.
--
-- Что НЕ покрывает MVP (отдельные PR):
--   • Self-view (юзер видит свою активность). Сейчас admin-only.
--   • Per-page popover «12 человек прочитали, среднее 4м». Admin-only
--     drill-down через дашборд.
--   • Materialized view для топ-N — пока считаем on-the-fly через
--     обычные индексы. Добавим если в проде запрос станет узким местом.
--   • TTL / retention. Без partition + drop в MVP.
--
-- Permission `kb.view_analytics` (UUID …000062) — owner / admin /
-- manager. accountant НЕ дают (kb-аналитика — это HR-метрика, не
-- финансовая); hostess / waiter — нет.
-- ============================================================

-- ============================================================
-- 1. kb_page_view_sessions — raw event log
-- ============================================================

create table public.kb_page_view_sessions (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id)  on delete cascade,
  page_id           uuid not null references public.kb_pages(id)  on delete cascade,
  user_id           uuid not null references auth.users(id)       on delete cascade,
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_seconds  integer not null check (duration_seconds >= 0),
  created_at        timestamptz not null default now(),
  -- Sanity: ended_at >= started_at и duration не врёт. Защищает от
  -- bug'ов в client-heartbeat'е (race на visibilitychange) — cheap
  -- check, ловит 99% glitches.
  constraint kb_page_view_sessions_time_chk
    check (ended_at >= started_at)
);

comment on table public.kb_page_view_sessions is
  'Сессии просмотра KB-страниц per-user. Запись = один непрерывный '
  'просмотр (визит). Heartbeat-based трекинг через client-side '
  'useKbPageViewTracker; flush через RPC kb_record_page_view.';

comment on column public.kb_page_view_sessions.duration_seconds is
  'Активное время на странице, без idle-периодов (>60с без mouse/key/'
  'scroll = idle, не учитывается). Если клиент забыл закрыть вкладку, '
  'tracker режет на 30-минутные чанки на стороне client (сервер не '
  'должен догадываться, реален ли многочасовой visit).';

-- Индексы:
--   1. По (page_id, started_at desc) — per-page drill-down
--      «кто читал страницу X».
--   2. По (account_id, user_id, started_at desc) — top-users
--      dashboard и getMyRecentlyViewed.
--   3. По (account_id, started_at desc) — top-pages dashboard
--      (фильтр по периоду + GROUP BY page_id).
create index kb_page_view_sessions_page_idx
  on public.kb_page_view_sessions(page_id, started_at desc);

create index kb_page_view_sessions_user_idx
  on public.kb_page_view_sessions(account_id, user_id, started_at desc);

create index kb_page_view_sessions_account_idx
  on public.kb_page_view_sessions(account_id, started_at desc);

alter table public.kb_page_view_sessions enable row level security;

-- SELECT: owner-of-row ИЛИ kb.view_analytics permission. Сотрудник
-- БЕЗ permission НЕ видит даже свои сессии (юзер выбрал admin-only
-- scope в Sprint D plan §2 — без self-view, чтобы не множить privacy-
-- сурфейсы).
create policy "kb_page_view_sessions_select" on public.kb_page_view_sessions
  for select using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_analytics')
  );

-- INSERT: client использует RPC kb_record_page_view (security definer,
-- проверяет account membership и kb.view_pages permission). Прямой
-- INSERT не разрешаем — слишком легко спамить fake-сессиями.
-- (RLS-политика для INSERT отсутствует => запрещено anon/authenticated.)

-- НЕТ UPDATE / DELETE — read-only event log. Если страница удалится,
-- CASCADE FK уберёт сессии автоматически.

grant select on public.kb_page_view_sessions to authenticated;

-- ============================================================
-- 2. RPC kb_record_page_view — единственный путь записи
-- ============================================================

-- Старая 4-арг сигнатура (с `p_duration_seconds`) была caller-trusted
-- — авторизованный юзер мог послать произвольное число и накрутить
-- top-N виджеты дашборда. См. Codex #57 P1 #1. DROP'аем явно, чтобы
-- не оставить privileged callable shadow-функцию.
drop function if exists public.kb_record_page_view(
  uuid, timestamptz, timestamptz, integer
);

create or replace function public.kb_record_page_view(
  p_page_id    uuid,
  p_started_at timestamptz,
  p_ended_at   timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id       uuid;
  v_user_id          uuid := auth.uid();
  v_session_id       uuid;
  v_duration_seconds integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  -- 1. Проверяем permission на view (без него юзер вообще не должен
  -- открывать страницу; tracker не должен пинговать). Defense in depth.
  if not public.has_permission('kb.view_pages') then
    raise exception 'kb.view_pages permission required'
      using errcode = '42501';
  end if;

  -- 2. Получаем account_id из page'а. Page обязан жить в active account
  -- юзера — иначе cross-tenant trick (юзер залогинен в account A,
  -- запрашивает page из B).
  select account_id into v_account_id
    from public.kb_pages
   where id = p_page_id
     and account_id = public.get_active_account_id()
     and deleted_at is null;

  if v_account_id is null then
    raise exception 'Page not found or not accessible'
      using errcode = '42704';
  end if;

  -- 3. Считаем duration на сервере из переданных timestamp'ов. НЕ
  -- доверяем client'у — caller мог бы послать любое число и накрутить
  -- top-N (Codex #57 P1 #1).
  v_duration_seconds := floor(
    extract(epoch from (p_ended_at - p_started_at))
  )::integer;

  -- 4. Sanity-check: не отрицательное, не аномально длинное (max 30
  -- мин одной сессией — client tracker уже режет на чанки).
  if v_duration_seconds < 0 or v_duration_seconds > 1800 then
    raise exception 'session duration out of range [0, 1800]'
      using errcode = '22023';
  end if;

  -- 5. Noise filter: < 5 сек = ничего полезного. Юзер открыл и сразу
  -- закрыл — не пишем.
  if v_duration_seconds < 5 then
    return null;
  end if;

  insert into public.kb_page_view_sessions (
    account_id, page_id, user_id,
    started_at, ended_at, duration_seconds
  ) values (
    v_account_id, p_page_id, v_user_id,
    p_started_at, p_ended_at, v_duration_seconds
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

comment on function public.kb_record_page_view(uuid, timestamptz, timestamptz) is
  'Записывает one-shot сессию просмотра KB-страницы. Вызывается из '
  'client-side useKbPageViewTracker на flush (visibilitychange / unmount '
  '/ beforeunload). Возвращает id вставленной строки или NULL если '
  'duration < 5 сек (noise filter). Security definer + проверка '
  'kb.view_pages + page в active account (anti cross-tenant). '
  'Duration считается серверно из p_started_at/p_ended_at — caller-'
  'provided value игнорируется (Codex #57 P1 #1).';

revoke all on function public.kb_record_page_view(uuid, timestamptz, timestamptz) from public;
grant execute on function public.kb_record_page_view(uuid, timestamptz, timestamptz) to authenticated;

-- ============================================================
-- 3. Permission `kb.view_analytics`
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000062',
   'kb.view_analytics',
   'Просматривать аналитику KB (топ-страниц, активность сотрудников)',
   'kb');

-- Default-матрица: owner / admin / manager. accountant — НЕТ
-- (kb-аналитика = HR-метрика, не финансовая; не их зона). hostess /
-- waiter — НЕТ (только потребители контента).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000062'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000002'::uuid)   -- manager
) as r(role_id);
