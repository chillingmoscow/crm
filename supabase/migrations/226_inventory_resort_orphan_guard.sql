-- Инвариант: активный пересорт не может остаться без пары.
--
-- inventory_result_resort_items.document_item_id — FK с ON DELETE CASCADE
-- (миграция 177). Когда строка акта исчезает (позицию удалили в Quick Resto,
-- QR пересоздал строки с новыми id, позицию вынесли в акт пересчёта), позиция
-- пересорта уходит каскадом, а ШАПКА пересорта остаётся 'active' и продолжает
-- участвовать в управленческом итоге — в том числе своей cost_adjustment_sum,
-- которая уже ни на чём не основана.
--
-- Прикладной путь закрыт: после импорта recalculateActiveResorts аннулирует
-- такой пересорт. Но инварианта на уровне БД не было — при любом другом пути
-- удаления состояние снова разъезжалось. Триггер ниже закрывает это в БД.
--
-- Аннулируем, когда после удаления позиции у активного пересорта осталось
-- меньше двух позиций ИЛИ пропала одна из ролей (нечего с чем сводить).

create or replace function public.inventory_void_orphan_resort()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_remaining integer;
  v_roles     integer;
begin
  -- Удаляют акт целиком (каскад): и пересорт, и журнал уедут вместе с ним.
  -- Строка documents к моменту работы AFTER-триггера уже удалена, поэтому
  -- проверка exists и отличает каскад от точечного удаления позиции.
  if not exists (select 1 from public.documents d where d.id = old.document_id) then
    return null;
  end if;

  -- Пересорт удаляют целиком — аннулировать нечего.
  if not exists (
    select 1
      from public.inventory_result_resorts r
     where r.id = old.resort_id
       and r.status = 'active'
  ) then
    return null;
  end if;

  select count(*), count(distinct i.role)
    into v_remaining, v_roles
    from public.inventory_result_resort_items i
   where i.resort_id = old.resort_id;

  -- Пара уцелела (есть и недостача, и излишек) — пересорт остаётся активным.
  -- Его суммы приводит к свежим значениям прикладной recalculateActiveResorts.
  if v_remaining >= 2 and v_roles >= 2 then
    return null;
  end if;

  update public.inventory_result_resorts
     set status      = 'voided',
         voided_at   = now(),
         void_reason = 'Строка акта удалена — пересорт остался без пары'
   where id = old.resort_id
     and status = 'active';

  -- След в журнале акта: аннулирование пересорта пользователь должен видеть.
  -- created_by = null: удаление приходит из синхронизации, а не от человека.
  insert into public.inventory_result_events (
    account_id, document_id, resort_id, event_type, message, payload
  )
  values (
    old.account_id,
    old.document_id,
    old.resort_id,
    'resort_voided',
    'Пересорт аннулирован: строка акта удалена',
    jsonb_build_object(
      'reason', 'orphan_resort_item',
      'removedProductName', old.product_name,
      'removedDocumentItemId', old.document_item_id,
      'remainingItems', v_remaining
    )
  );

  return null;
end;
$$;

comment on function public.inventory_void_orphan_resort() is
  'Аннулирует активный пересорт, когда после удаления позиции у него не осталось пары (меньше двух позиций или пропала одна из ролей). Пишет событие resort_voided в журнал акта.';

drop trigger if exists inventory_result_resort_items_orphan_guard
  on public.inventory_result_resort_items;

create trigger inventory_result_resort_items_orphan_guard
  after delete on public.inventory_result_resort_items
  for each row
  execute function public.inventory_void_orphan_resort();

-- Разовая уборка уже разъехавшихся пересортов: активные шапки, у которых
-- позиций меньше двух или нет обеих ролей.
update public.inventory_result_resorts r
   set status      = 'voided',
       voided_at   = now(),
       void_reason = coalesce(r.void_reason, 'Строка акта удалена — пересорт остался без пары')
 where r.status = 'active'
   and (
     select count(*) < 2 or count(distinct i.role) < 2
       from public.inventory_result_resort_items i
      where i.resort_id = r.id
   );
