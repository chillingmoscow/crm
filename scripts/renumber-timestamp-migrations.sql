-- Правка реестра миграций для прода: девять timestamp-миграций получают линейные номера 298–306.
--
-- ПРИМЕНЯЕТСЯ ВРУЧНУЮ, по SSH, после мержа переименования в main, и только с явного
-- согласия владельца. Скрипт ничего не применяет сам и не запускается из CI или миграций.
--
-- Для каждого файла: если строка с прежней версией есть — переписываем version на новый номер;
-- если её нет — вставляем строку с новым номером, а не пропускаем молча. Существующая строка
-- с новым номером не перезаписывается (where not exists).
--
-- Сверка: число строк до и после должно совпасть (новых строк не появляется, если все девять
-- прежних версий найдены). Смотреть вывод select в начале и в конце.

begin;

select count(*) as rows_before from supabase_migrations.schema_migrations;

select version, name
from supabase_migrations.schema_migrations
where version in (
  '20260301162546', '20260509120000', '20261030231538',
  '20261031002045', '20261031144659', '20261031153759',
  '20261031171241', '20261101165423', '20261101174630'
)
order by version;

update supabase_migrations.schema_migrations set version = '298' where version = '20260301162546';
insert into supabase_migrations.schema_migrations (version, name)
select '298', 'gender_constraint'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '298');

update supabase_migrations.schema_migrations set version = '299' where version = '20260509120000';
insert into supabase_migrations.schema_migrations (version, name)
select '299', 'account_amount_rounding'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '299');

update supabase_migrations.schema_migrations set version = '300' where version = '20261030231538';
insert into supabase_migrations.schema_migrations (version, name)
select '300', 'candidate_bulk_delete'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '300');

update supabase_migrations.schema_migrations set version = '301' where version = '20261031002045';
insert into supabase_migrations.schema_migrations (version, name)
select '301', 'integrations_recruiting_settings'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '301');

update supabase_migrations.schema_migrations set version = '302' where version = '20261031144659';
insert into supabase_migrations.schema_migrations (version, name)
select '302', 'people_overviews'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '302');

update supabase_migrations.schema_migrations set version = '303' where version = '20261031153759';
insert into supabase_migrations.schema_migrations (version, name)
select '303', 'recruiting_overview_funnel'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '303');

update supabase_migrations.schema_migrations set version = '304' where version = '20261031171241';
insert into supabase_migrations.schema_migrations (version, name)
select '304', 'staff_profile_identity'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '304');

update supabase_migrations.schema_migrations set version = '305' where version = '20261101165423';
insert into supabase_migrations.schema_migrations (version, name)
select '305', 'staff_document_access'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '305');

update supabase_migrations.schema_migrations set version = '306' where version = '20261101174630';
insert into supabase_migrations.schema_migrations (version, name)
select '306', 'staff_document_formats'
where not exists (select 1 from supabase_migrations.schema_migrations where version = '306');

select count(*) as rows_after from supabase_migrations.schema_migrations;

select version, name
from supabase_migrations.schema_migrations
where version between '298' and '306'
order by version;

-- Ожидаемо: rows_after = rows_before, если все девять прежних строк нашлись.
-- Разница = число вставленных строк (их вывод select в начале покажет, каких не хватало).
-- Если результат не сходится с ожиданием, заменить commit на rollback и разобраться.
commit;
