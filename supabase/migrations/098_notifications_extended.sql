-- ============================================================
-- 098_notifications_extended.sql
--
-- Расширение public.notifications для Notion-style bell:
-- preview-cards (snippet + actor + entity), inline-actions, archive,
-- cross-module category. Backwards-compatible — все новые колонки
-- nullable / с дефолтом, существующие emit'еры (079, 083, 090, 094,
-- 095) продолжают работать без изменений в этой миграции (refresh
-- эмиттеров — отдельная миграция 100).
-- ============================================================

alter table public.notifications
  -- Module category для cross-module bell-фильтров. Извлекается из
  -- type'а (split на первой точке) для backfill'а: текущие kb.* →
  -- 'kb', invite/warning/system → 'system'. Будущие модули
  -- (finance / schedule / staff) свои category объявляют через
  -- type-prefix.
  add column if not exists category text not null default 'system',

  -- Actor — кто инициировал событие (юзер, который @-упомянул /
  -- toggle'ил required-reading / ответил в треде). NULL для system-
  -- emit'ов (cron, миграции). Bell использует для рендера avatar +
  -- "Pavel сделал X".
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,

  -- Entity reference — на какую сущность ссылается notif. Pair с
  -- entity_type для discriminator'а: 'kb_page' / 'kb_thread' /
  -- 'finance_transaction' / etc. Bell использует для дедупа и
  -- группировки notif'ов по entity (опционально в будущем).
  add column if not exists entity_type text,
  add column if not exists entity_id   uuid,

  -- Архив state: NULL = active, NOT NULL = archived. Юзер либо
  -- руками архивирует, либо cron auto-archive'ит read+old (миграция
  -- 099).
  add column if not exists archived_at timestamptz,

  -- Rich payload для preview-cards + inline-actions. Schema (free-form):
  -- {
  --   "preview": "Первые 180 символов цитируемого контента…",
  --   "preview_kind": "page_excerpt" | "comment_text" | "transaction_amount" | ...,
  --   "actions": [{"label": "Открыть", "action_type": "kb.open_page", "target_id": "uuid"}],
  --   ...
  -- }
  --
  -- Default — пустой объект, не null, чтобы JSON-операции в client'е
  -- не падали на null'е.
  add column if not exists payload jsonb not null default '{}'::jsonb;

-- ============================================================
-- Backfill category из существующего type'а
-- ============================================================
-- Извлекаем prefix до первой точки, fallback'имся на 'system'. После
-- этой миграции новые INSERT'ы должны явно указывать category из
-- emit-RPC (миграция 100), но legacy rows получают разумный дефолт.

update public.notifications
   set category = case
     when type like 'kb.%'       then 'kb'
     when type like 'finance.%'  then 'finance'
     when type like 'schedule.%' then 'schedule'
     when type like 'staff.%'    then 'staff'
     else 'system'
   end
 where category = 'system' and type not like '%.system';

-- ============================================================
-- Индексы для bell-paths
-- ============================================================
-- (1) Live list — user's non-archived rows, sorted by created_at desc.
--     Это горячий путь bell'а: SELECT … WHERE user_id = ? AND
--     archived_at IS NULL ORDER BY created_at DESC LIMIT 50.
create index if not exists notifications_user_active_idx
  on public.notifications(user_id, created_at desc)
  where archived_at is null;

-- (2) Archive scope — user's archived rows. Cold path, отдельный
--     index'ом избегаем full-scan'а если юзер посмотрит archive.
create index if not exists notifications_user_archived_idx
  on public.notifications(user_id, archived_at desc)
  where archived_at is not null;

-- (3) Auto-archive cron path — read=true rows ordered by created_at,
--     для batch update'ов. WHERE archived_at IS NULL — partial index
--     меньше, и DELETE'ы из horizon'а уйдут из index'а.
create index if not exists notifications_auto_archive_idx
  on public.notifications(read, created_at)
  where archived_at is null;

-- ============================================================
-- Comments
-- ============================================================

comment on column public.notifications.category is
  'Module category: kb / finance / schedule / staff / system. Backfill из '
  'type-prefix''а. Новые INSERT''ы emit''еров явно проставляют. '
  'Sprint E §1, миграция 098.';
comment on column public.notifications.actor_user_id is
  'Юзер, инициировавший событие (toggler / mention''ёр / commenter). '
  'NULL для system-emit''ов. Bell рендерит actor.avatar + verb.';
comment on column public.notifications.entity_type is
  'Discriminator для entity_id: kb_page / kb_thread / finance_transaction / etc.';
comment on column public.notifications.entity_id is
  'ID сущности на которую ссылается notif. Pair с entity_type. '
  'Используется для дедупа и группировки notif''ов в bell''е.';
comment on column public.notifications.archived_at is
  'NULL = active, NOT NULL = archived. Юзер архивирует руками ИЛИ '
  'cron auto-archive''ит read+old (миграция 099, 30-day TTL).';
comment on column public.notifications.payload is
  'Rich payload для preview-cards: {preview, preview_kind, actions[]}. '
  'Default пустой объект. Schema free-form per-emitter.';
