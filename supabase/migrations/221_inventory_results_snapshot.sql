-- Фиксация итогов акта на момент подведения + защита от повторного импорта.
--
-- Контекст (разбор акта СВ340, 2026-08-25). «Расчётный остаток» и «разница» в
-- итогах — НЕ наши вычисления: мы копируем их из Quick Resto как есть
-- (item.amountAtStore → calculated_amount, item.delta → difference_amount,
-- item.differenceCost → difference_sum; см. extractLineResult в
-- src/app/(dashboard)/inventory/actions-shared.ts).
--
-- Quick Resto пересчитывает эти величины по движениям товара, поэтому ОДНО И ТО
-- ЖЕ поле, прочитанное в разные моменты, даёт разные числа. Пример из прода:
-- по позиции «Стандарт / Palitra / Mango Cream» акта СВ340 в снимке от
-- 24.08.2026 10:21 UTC QR отдал расчётный остаток 0,2 кг (разница 0), а сутки
-- спустя показывал −0,4 кг (излишек 0,6 кг = 4350 ₽ при с/с 7250 ₽).
--
-- Следствия:
--   1) хранить итоги только в «живых» колонках нельзя — любой повторный импорт
--      («Обновить итоги из Quick Resto») затирает то, что утвердил проверяющий;
--   2) при подведении итогов нужен снимок строк, который потом не меняется.
--
-- Эта миграция добавляет снимок (finalized_*) и RPC, снимающий его.

-- 1) Снимок построчных итогов.
alter table public.document_items
  add column if not exists finalized_actual_amount     numeric,
  add column if not exists finalized_calculated_amount numeric,
  add column if not exists finalized_difference_amount numeric,
  add column if not exists finalized_difference_sum    numeric,
  add column if not exists finalized_prime_cost        numeric;

comment on column public.document_items.finalized_actual_amount is
  'Факт на момент подведения итогов. Снимок, не меняется при повторном импорте из Quick Resto.';
comment on column public.document_items.finalized_calculated_amount is
  'Расчётный остаток (Quick Resto amountAtStore) на момент подведения итогов. Снимок: QR пересчитывает эту величину по движениям, живое значение уходит от утверждённого.';
comment on column public.document_items.finalized_difference_amount is
  'Разница (Quick Resto delta) на момент подведения итогов. Снимок.';
comment on column public.document_items.finalized_difference_sum is
  'Сумма расхождения (Quick Resto differenceCost) на момент подведения итогов. Снимок.';
comment on column public.document_items.finalized_prime_cost is
  'Себестоимость на момент подведения итогов. Снимок.';

alter table public.documents
  add column if not exists results_snapshot_at timestamptz;

comment on column public.documents.results_snapshot_at is
  'Когда сняли снимок построчных итогов (finalized_* в document_items). Пока не null — страница итогов показывает снимок, а не живые значения из Quick Resto.';

-- 2) Снятие снимка. Вызывается только из server action (admin-клиент,
--    service_role) при подведении итогов, после проверки прав.
--    Column-to-column copy нельзя выразить через PostgREST — отсюда RPC.
--
--    Функция трогает ТОЛЬКО строки: documents.results_snapshot_at выставляет
--    сам экшен, вместе с results_finalized_at. Так снимок «включается» ровно
--    тогда, когда финализация реально доехала: если проведение в QR упадёт
--    между шагами, замороженные значения строк останутся лежать, но страница
--    продолжит показывать живые (акт не залочен).
create or replace function public.freeze_inventory_result_snapshot(
  p_account_id uuid,
  p_document_id uuid
)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_rows integer;
begin
  update public.document_items di
     set finalized_actual_amount     = di.actual_amount,
         finalized_calculated_amount = di.calculated_amount,
         finalized_difference_amount = di.difference_amount,
         finalized_difference_sum    = di.difference_sum,
         finalized_prime_cost        = di.prime_cost
   where di.account_id = p_account_id
     and di.document_id = p_document_id;
  get diagnostics v_rows = row_count;

  return v_rows;
end;
$$;

-- security invoker (по умолчанию): вызывающий — service_role, он и так
-- BYPASSRLS. Тенанту (authenticated) функция не нужна: снимок снимается только
-- в момент финализации, из server action. Прямой вызов закрываем, иначе это
-- дыра в lockdown'е записи по итогам из миграции 219.
revoke all on function public.freeze_inventory_result_snapshot(uuid, uuid) from public;
revoke all on function public.freeze_inventory_result_snapshot(uuid, uuid) from anon, authenticated;
grant execute on function public.freeze_inventory_result_snapshot(uuid, uuid) to service_role;

-- 3) Бэкфилл уже финализированных актов.
--    ВАЖНО: это фиксирует ТЕКУЩЕЕ состояние строк, а не «правду на момент
--    проведения» — для старых актов живые значения могли уже уехать (СВ340).
--    Смысл бэкфилла в другом: с этого момента их больше нельзя перетереть.
update public.document_items di
   set finalized_actual_amount     = di.actual_amount,
       finalized_calculated_amount = di.calculated_amount,
       finalized_difference_amount = di.difference_amount,
       finalized_difference_sum    = di.difference_sum,
       finalized_prime_cost        = di.prime_cost
  from public.documents d
 where d.id = di.document_id
   and d.account_id = di.account_id
   and d.results_finalized_at is not null
   and d.results_snapshot_at is null;

update public.documents d
   set results_snapshot_at = d.results_finalized_at
 where d.results_finalized_at is not null
   and d.results_snapshot_at is null;
