-- Первый вид новой коллекции назывался «Галерея», хотя это список: меню «/»
-- ставило это имя, и оно же было значением колонки по умолчанию (124).
-- Виды-списки с таким именем переименовываем в «Список»; таблицы, которые
-- кто-то сам назвал «Галерея», не трогаем. Новые виды получают «Список»
-- (kbCollectionSlashProps в src/lib/knowledge/collection.ts).
begin;

update public.kb_collection_views
set name = 'Список'
where name = 'Галерея'
  and view_type = 'list';

alter table public.kb_collection_views
  alter column name set default 'Список';

do $$
begin
  if exists (
    select 1
    from public.kb_collection_views
    where name = 'Галерея' and view_type = 'list'
  ) then
    raise exception 'Остались виды-списки с именем «Галерея»';
  end if;
end;
$$;

commit;
