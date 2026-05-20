-- ============================================================
-- 205_resort_cost_adjustment.sql
-- Учёт разницы себестоимостей при пересорте.
--
-- Проблема: алгоритм calculateResortAllocation уравнивает позиции по
-- ОБЪЁМУ, но не учитывает разницу в себестоимости. Пример:
--   - Виски A: недостача 1л, себестоимость 5000/л → −5000 sum
--   - Виски B: излишек 1л, себестоимость 3000/л → +3000 sum
-- Алгоритм покрывает 1л на 1л, оба остатка = 0. Но реальный убыток
-- компании = 5000 - 3000 = 2000 (списали дорогое, нашли дешёвое).
-- Эта разница терялась в management-учёте.
--
-- Фикс: новая колонка `cost_adjustment_sum`. Записывается значение
-- max(0, shortageCostPerUnit - surplusCostPerUnit) × offsetAmount.
-- Признаём только убыток (>=0) — управленческий консерватизм
-- (см. docs/handbook/inventory/resort.md). Корректировка плюсуется
-- к managementShortfallSum.
-- ============================================================

alter table public.inventory_result_resorts
  add column if not exists cost_adjustment_sum numeric not null default 0;

comment on column public.inventory_result_resorts.cost_adjustment_sum is
  'Управленческая корректировка себестоимости при пересорте. Признаётся '
  'только убыток (>=0). Формула: max(0, shortageCostPerUnit - '
  'surplusCostPerUnit) × offsetAmount. См. docs/handbook/inventory/resort.md.';
