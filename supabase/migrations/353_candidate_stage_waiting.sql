-- Сортировка «На этапе» в списке кандидатов ставит наверх тех, кто ждёт
-- дольше всех. У отказанных («Не подходит») срока нет, но их дата перехода
-- обычно самая старая — без отдельного ключа они занимали первые страницы.
-- stage_waiting = анкета ещё в работе; при этой сортировке он идёт первым
-- ключом, отказанные уходят в конец. Принятые в список не попадают.
alter table public.candidates
  add column if not exists stage_waiting boolean
  generated always as (status not in ('rejected', 'hired')) stored;

notify pgrst, 'reload schema';
