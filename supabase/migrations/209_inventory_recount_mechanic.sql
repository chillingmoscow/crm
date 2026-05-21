-- ============================================================
-- 209_inventory_recount_mechanic.sql
-- PR3 — Recount mechanic (анти-подгонка):
--   * Новый статус акта `recount_pending` (после ready_for_review).
--   * Флаги на document_items: needs_recount + аудит.
--   * documents.recount_count / last_returned_at.
--   * venues.inventory_recount_threshold_sum / _percent.
--   * Permission inventory.recount_documents (модуль inventory_documents).
--   * Триггер автомаркера по threshold'у venue.
--
-- См. docs/superpowers/specs/2026-05-21-inventory-recount-mechanic-design.md
-- ============================================================

-- 1. Enum: добавляем recount_pending после ready_for_review.
--    Заметка: ALTER TYPE ADD VALUE безопасен внутри transaction-block'а —
--    значение становится доступно после commit. В рамках этой миграции
--    мы новое значение НИГДЕ не используем (только определяем структуры);
--    runtime-код ссылается на него после деплоя. Если миграция применяется
--    через SSH-apply с `-1`, всё в одной транзакции — это OK.
alter type public.inventory_document_status_enum
  add value if not exists 'recount_pending' after 'ready_for_review';

-- 2. document_items: флаг + аудит.
alter table public.document_items
  add column if not exists needs_recount         boolean not null default false,
  add column if not exists recount_auto_flagged  boolean not null default false,
  add column if not exists recount_marked_by     uuid references public.profiles(id) on delete set null,
  add column if not exists recount_marked_at     timestamptz,
  add column if not exists recount_note          text;

comment on column public.document_items.needs_recount is
  'Строка требует повторного счёта. Включается авто-триггером по threshold venue или вручную менеджером.';
comment on column public.document_items.recount_auto_flagged is
  'true если флаг поставил триггер (а не менеджер). recount_marked_by указывает на ручную правку.';
comment on column public.document_items.recount_marked_by is
  'Кто последний раз менял needs_recount вручную. NULL = автомат.';

-- Партиальный индекс — селекты «строки, требующие пересчёта» по документу.
create index if not exists document_items_needs_recount_idx
  on public.document_items(document_id)
  where needs_recount = true;

-- 3. documents: счётчик возвратов + last_returned_at.
alter table public.documents
  add column if not exists recount_count    integer not null default 0,
  add column if not exists last_returned_at timestamptz;

comment on column public.documents.recount_count is
  'Сколько раз акт возвращали на пересчёт.';
comment on column public.documents.last_returned_at is
  'Timestamp последнего возврата на пересчёт. Используется в editor-hydration: draft.savedAt < last_returned_at → draft устаревший.';

-- 4. venues: пороги авто-маркера.
alter table public.venues
  add column if not exists inventory_recount_threshold_sum     numeric(12,2) not null default 500.00,
  add column if not exists inventory_recount_threshold_percent numeric(6,2)  not null default 10.00,
  add constraint venues_recount_threshold_sum_nonnegative     check (inventory_recount_threshold_sum >= 0),
  add constraint venues_recount_threshold_percent_in_range   check (inventory_recount_threshold_percent >= 0 and inventory_recount_threshold_percent <= 100);

comment on column public.venues.inventory_recount_threshold_sum is
  'Порог по сумме расхождения для авто-маркера пересчёта (₽). По умолчанию 500.';
comment on column public.venues.inventory_recount_threshold_percent is
  'Порог по проценту расхождения для авто-маркера пересчёта (%). По умолчанию 10.';

-- 5. Permission: новый код.
insert into public.permissions (code, module, description)
values (
  'inventory.recount_documents',
  'inventory_documents',
  'Возвращать акты инвентаризации на пересчёт (отмечать подозрительные строки и отправлять акт исполнителю)'
)
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- Backfill: триггер apply_default_inventory_permissions_to_role срабатывает
-- только на INSERT новой роли. Существующим custom_admin/custom_manager
-- ролям выдадим новое право явно (аналогично паттерну миграции 175 backfill).
insert into public.role_permissions (role_id, permission_id, granted)
select r.id, p.id, true
from public.roles r
cross join public.permissions p
where r.code in ('custom_manager', 'custom_admin')
  and p.code = 'inventory.recount_documents'
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- 5b. Расширяем CHECK на inventory_result_events.event_type — иначе
-- запись recount-событий в журнал упадёт по констрейнту (был задан в
-- миграции 178). Добавляем три новых типа.
alter table public.inventory_result_events
  drop constraint if exists inventory_result_events_event_type_check;

alter table public.inventory_result_events
  add constraint inventory_result_events_event_type_check
  check (
    event_type in (
      'comment_updated',
      'exclude_enabled',
      'exclude_disabled',
      'persistent_exclusion_enabled',
      'persistent_exclusion_disabled',
      'resort_created',
      'resort_voided',
      'results_finalized',
      'results_reopened',
      'results_refreshed',
      'suggestion_applied',
      'suggestion_dismissed',
      -- recount mechanic (PR3):
      'recount_marked',
      'recount_unmarked',
      'returned_for_recount'
    )
  );

-- 6. Триггер автомаркера. Срабатывает на INSERT/UPDATE document_items
-- при изменении difference_sum/difference_amount/calculated_amount.
-- Логика:
--   * Если |difference_sum| > venue.threshold_sum
--     ИЛИ |difference_amount| / nullif(calculated_amount,0) * 100 > venue.threshold_percent
--     → needs_recount := true, recount_auto_flagged := true (если флаг
--       не был установлен вручную).
--   * Если threshold НЕ пересечён и предыдущий флаг был автоматический —
--     снимаем (расхождение «исправилось»).
--   * Ручные пометки (recount_marked_by IS NOT NULL) триггер НЕ трогает.
create or replace function public.inventory_apply_recount_threshold()
returns trigger
language plpgsql
security definer
-- SET search_path обязателен, см. memory feedback_create_or_replace_search_path.
set search_path = public, pg_catalog
as $$
declare
  v_threshold_sum     numeric;
  v_threshold_percent numeric;
  v_sum_breached      boolean;
  v_pct_breached      boolean;
  v_breached          boolean;
begin
  -- venue thresholds через денормализованный documents.venue_id (миграция 194).
  select v.inventory_recount_threshold_sum, v.inventory_recount_threshold_percent
    into v_threshold_sum, v_threshold_percent
    from public.documents d
    join public.venues v on v.id = d.venue_id
   where d.id = new.document_id;

  -- Если у акта нет venue (rare/legacy data) — пропускаем автомаркер.
  if v_threshold_sum is null then
    return new;
  end if;

  v_sum_breached := abs(coalesce(new.difference_sum, 0)) > v_threshold_sum;
  v_pct_breached := coalesce(new.calculated_amount, 0) > 0
                    and abs(coalesce(new.difference_amount, 0)) / new.calculated_amount * 100 > v_threshold_percent;
  v_breached := v_sum_breached or v_pct_breached;

  if v_breached then
    -- Авто-флаг ставим только если не было ручной пометки.
    if new.recount_marked_by is null then
      new.needs_recount        := true;
      new.recount_auto_flagged := true;
    end if;
  else
    -- Снимаем только авто-флаг; ручные оставляем.
    if new.recount_auto_flagged = true and new.recount_marked_by is null then
      new.needs_recount        := false;
      new.recount_auto_flagged := false;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.inventory_apply_recount_threshold() from public;

drop trigger if exists trg_inventory_apply_recount_threshold on public.document_items;
create trigger trg_inventory_apply_recount_threshold
  before insert or update of difference_sum, difference_amount, calculated_amount
  on public.document_items
  for each row
  execute function public.inventory_apply_recount_threshold();
