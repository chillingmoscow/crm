-- ============================================================
-- 214_push_subscriptions.sql
-- Web Push: подписки браузеров + отметка о доставке push.
--
-- 1. Таблица push_subscriptions — одна строка = одно устройство
--    (endpoint). Это per-user-device auth-инфра (как сама таблица
--    notifications, миграция 013), НЕ account-scoped бизнес-данные,
--    поэтому без account_id и без archived-lifecycle: мёртвые подписки
--    (HTTP 404/410 от push-сервиса) удаляются жёстко диспетчером.
-- 2. notifications.pushed_at — диспетчер /api/cron/push-dispatch
--    атомарно «клеймит» неразосланные строки (pushed_at IS NULL),
--    чтобы перекрытие cron-запусков не дало двойной push.
-- ============================================================

-- ── 1. push_subscriptions ───────────────────────────────────
create table if not exists public.push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Пользователь управляет только своими подписками. auth.uid() обёрнут
-- в (select ...) сразу — Postgres хоистит его в InitPlan (advisor
-- auth_rls_initplan). Диспетчер ходит через service-role и обходит RLS.
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  using ((select auth.uid()) = user_id);

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  using ((select auth.uid()) = user_id);

-- Диспетчер выбирает подписки по user_id (where user_id = any(...)).
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- ── 2. notifications.pushed_at ──────────────────────────────
alter table public.notifications
  add column if not exists pushed_at timestamptz;

-- Backfill: всю историю помечаем как уже доставленную, чтобы при первом
-- запуске диспетчера не улетела пачка push'ей по старым уведомлениям.
-- Новые INSERT'ы (триггеры/cron не задают pushed_at) → NULL → разошлются.
update public.notifications
  set pushed_at = now()
  where pushed_at is null;

-- Частичный индекс — дешёвый добор неразосланных строк диспетчером.
-- После backfill индекс почти пуст (только свежие неразосланные строки).
create index if not exists notifications_unpushed_idx
  on public.notifications (created_at)
  where pushed_at is null;
