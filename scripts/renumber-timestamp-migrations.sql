-- Правка реестра миграций для прода: девять timestamp-миграций получают линейные номера 298–306.
--
-- ПРИМЕНЯЕТСЯ ВРУЧНУЮ, по SSH, после мержа переименования в main, и только с явного
-- согласия владельца. Скрипт ничего не применяет сам и не запускается из CI или миграций.
--
-- Перед запуском: \d supabase_migrations.schema_migrations
-- Проверить, что колонки version и name есть и что это прод, а не локальная база.
-- Запуск: psql ... -f scripts/renumber-timestamp-migrations.sql
--
-- Поведение:
--   * ON_ERROR_STOP включён: любая ошибка останавливает скрипт и откатывает транзакцию.
--   * Для каждой пары: если строка с прежней версией есть — version и name переписываются
--     (name задаётся явно, старое имя не сохраняется); если строки нет — вставляется строка
--     с новым номером и тем же именем, и это выводится в NOTICE.
--   * В конце DO-блок сверяет результат и делает raise exception при расхождении:
--     число строк должно вырасти ровно на число вставленных строк, прежних версий не остаётся,
--     новых строк ровно девять. При расхождении транзакция откатывается сама.
--   * По умолчанию скрипт заканчивается rollback. Фиксация — только после проверки вывода:
--     заменить последнюю строку на commit (раскомментировать -- commit; и убрать rollback).

\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'supabase_migrations.schema_migrations не найдена: не та база';
  end if;
end $$;

select current_database() as database_name;

select count(*) as rows_before from supabase_migrations.schema_migrations;

create temp table renumber_map (
  old_version text primary key,
  new_version text not null,
  new_name    text not null
) on commit drop;

insert into renumber_map (old_version, new_version, new_name) values
  ('20260301162546', '298', 'gender_constraint'),
  ('20260509120000', '299', 'account_amount_rounding'),
  ('20261030231538', '300', 'candidate_bulk_delete'),
  ('20261031002045', '301', 'integrations_recruiting_settings'),
  ('20261031144659', '302', 'people_overviews'),
  ('20261031153759', '303', 'recruiting_overview_funnel'),
  ('20261031171241', '304', 'staff_profile_identity'),
  ('20261101165423', '305', 'staff_document_access'),
  ('20261101174630', '306', 'staff_document_formats');

select m.old_version, m.new_version,
       exists (select 1 from supabase_migrations.schema_migrations s where s.version = m.old_version) as old_row_present
from renumber_map m
order by m.new_version;

do $$
declare
  r record;
  rows_before int;
  rows_after int;
  inserted int := 0;
  old_left int;
  new_count int;
begin
  select count(*) into rows_before from supabase_migrations.schema_migrations;

  for r in select * from renumber_map order by new_version loop
    if exists (select 1 from supabase_migrations.schema_migrations where version = r.old_version) then
      update supabase_migrations.schema_migrations
         set version = r.new_version, name = r.new_name
       where version = r.old_version;
    else
      if not exists (select 1 from supabase_migrations.schema_migrations where version = r.new_version) then
        insert into supabase_migrations.schema_migrations (version, name)
        values (r.new_version, r.new_name);
        inserted := inserted + 1;
        raise notice 'строки % не было, вставлена строка с номером %', r.old_version, r.new_version;
      end if;
    end if;
  end loop;

  select count(*) into rows_after from supabase_migrations.schema_migrations;

  select count(*) into old_left
  from supabase_migrations.schema_migrations s
  join renumber_map m on s.version = m.old_version;

  select count(*) into new_count
  from supabase_migrations.schema_migrations s
  join renumber_map m on s.version = m.new_version;

  if old_left <> 0 then
    raise exception 'остались строки со старыми версиями: %', old_left;
  end if;
  if new_count <> 9 then
    raise exception 'строк с новыми версиями 298–306 должно быть 9, найдено %', new_count;
  end if;
  if rows_after <> rows_before + inserted then
    raise exception 'число строк: до % после %, вставлено %, ожидалось after = before + inserted',
      rows_before, rows_after, inserted;
  end if;
  raise notice 'сверка пройдена: до %, после %, вставлено %', rows_before, rows_after, inserted;
end $$;

select version, name
from supabase_migrations.schema_migrations
where version between '298' and '306'
order by version;

-- Прод по умолчанию: откат. Фиксация только после проверки вывода выше.
-- commit;  (раскомментировать только после проверки: заменить rollback на commit)
rollback;
