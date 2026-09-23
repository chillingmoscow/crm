-- Снимок итогов должен включать пересорты и исключения.
--
-- Миграция 221 заморозила построчные значения акта (document_items.finalized_*),
-- но управленческий итог складывается ещё из двух источников, которых в снимке
-- не было:
--   * inventory_result_resorts / inventory_result_resort_items — объём зачёта,
--     остатки и корректировка себестоимости;
--   * document_items.excluded_from_totals — исключение строки из итогов.
--
-- Пересорты к тому же пересчитываются при каждом импорте (recalculateActiveResorts),
-- то есть у зафиксированного акта построчные числа заморожены, а зачёт мог
-- поехать позже: в одном итоге оказывались две разные даты. Замораживаем оба
-- источника и считаем управленческий итог зафиксированного акта по снимку
-- целиком.

alter table public.document_items
  add column if not exists finalized_excluded_from_totals boolean;

comment on column public.document_items.finalized_excluded_from_totals is
  'Была ли строка исключена из итогов на момент подведения итогов. Снимок: правило автоисключения могло появиться/исчезнуть позже.';

alter table public.inventory_result_resorts
  add column if not exists finalized_at                     timestamptz,
  add column if not exists finalized_status                 text,
  add column if not exists finalized_offset_amount          numeric,
  add column if not exists finalized_residual_shortfall_sum numeric,
  add column if not exists finalized_residual_surplus_sum   numeric,
  add column if not exists finalized_cost_adjustment_sum    numeric;

comment on column public.inventory_result_resorts.finalized_at is
  'Когда с пересорта сняли снимок итогов. Явный маркер «снимок есть»: пересорт, созданный после фиксации, снимка не имеет.';
comment on column public.inventory_result_resorts.finalized_status is
  'Статус пересорта (active/voided) на момент подведения итогов. Управленческий итог зафиксированного акта считается по нему, а не по живому статусу.';

alter table public.inventory_result_resort_items
  add column if not exists finalized_at                          timestamptz,
  add column if not exists finalized_source_difference_amount    numeric,
  add column if not exists finalized_source_difference_sum       numeric,
  add column if not exists finalized_offset_amount               numeric,
  add column if not exists finalized_remaining_difference_amount numeric,
  add column if not exists finalized_remaining_difference_sum    numeric;

comment on column public.inventory_result_resort_items.finalized_at is
  'Когда с позиции пересорта сняли снимок итогов. Позиция, добавленная после фиксации, снимка не имеет.';

-- Снятие снимка: теперь три таблицы. Возвращает число замороженных строк акта
-- (как и раньше) — вызывающему важен сам факт успеха.
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
  v_now  timestamptz := now();
begin
  update public.document_items di
     set finalized_at                   = v_now,
         finalized_actual_amount        = di.actual_amount,
         finalized_calculated_amount    = di.calculated_amount,
         finalized_difference_amount    = di.difference_amount,
         finalized_difference_sum       = di.difference_sum,
         finalized_prime_cost           = di.prime_cost,
         finalized_excluded_from_totals = di.excluded_from_totals
   where di.account_id = p_account_id
     and di.document_id = p_document_id;
  get diagnostics v_rows = row_count;

  update public.inventory_result_resorts r
     set finalized_at                     = v_now,
         finalized_status                 = r.status,
         finalized_offset_amount          = r.offset_amount,
         finalized_residual_shortfall_sum = r.residual_shortfall_sum,
         finalized_residual_surplus_sum   = r.residual_surplus_sum,
         finalized_cost_adjustment_sum    = r.cost_adjustment_sum
   where r.account_id = p_account_id
     and r.document_id = p_document_id;

  update public.inventory_result_resort_items i
     set finalized_at                          = v_now,
         finalized_source_difference_amount    = i.source_difference_amount,
         finalized_source_difference_sum       = i.source_difference_sum,
         finalized_offset_amount               = i.offset_amount,
         finalized_remaining_difference_amount = i.remaining_difference_amount,
         finalized_remaining_difference_sum    = i.remaining_difference_sum
   where i.account_id = p_account_id
     and i.document_id = p_document_id;

  return v_rows;
end;
$$;

-- Гранты пересоздаются вместе с функцией (CREATE OR REPLACE сбрасывает всё,
-- что не перечислено заново) — см. миграцию 221.
revoke all on function public.freeze_inventory_result_snapshot(uuid, uuid) from public;
revoke all on function public.freeze_inventory_result_snapshot(uuid, uuid) from anon, authenticated;
grant execute on function public.freeze_inventory_result_snapshot(uuid, uuid) to service_role;

-- Бэкфилл уже зафиксированных актов: как и в 221, замораживаем ТЕКУЩЕЕ
-- состояние — смысл в том, чтобы дальше его нельзя было перетереть.
update public.document_items di
   set finalized_excluded_from_totals = di.excluded_from_totals
  from public.documents d
 where d.id = di.document_id
   and d.account_id = di.account_id
   and d.results_snapshot_at is not null
   and di.finalized_at is not null
   and di.finalized_excluded_from_totals is null;

update public.inventory_result_resorts r
   set finalized_at                     = d.results_snapshot_at,
       finalized_status                 = r.status,
       finalized_offset_amount          = r.offset_amount,
       finalized_residual_shortfall_sum = r.residual_shortfall_sum,
       finalized_residual_surplus_sum   = r.residual_surplus_sum,
       finalized_cost_adjustment_sum    = r.cost_adjustment_sum
  from public.documents d
 where d.id = r.document_id
   and d.account_id = r.account_id
   and d.results_snapshot_at is not null
   and r.finalized_at is null;

update public.inventory_result_resort_items i
   set finalized_at                          = d.results_snapshot_at,
       finalized_source_difference_amount    = i.source_difference_amount,
       finalized_source_difference_sum       = i.source_difference_sum,
       finalized_offset_amount               = i.offset_amount,
       finalized_remaining_difference_amount = i.remaining_difference_amount,
       finalized_remaining_difference_sum    = i.remaining_difference_sum
  from public.documents d
 where d.id = i.document_id
   and d.account_id = i.account_id
   and d.results_snapshot_at is not null
   and i.finalized_at is null;
