-- Каталог учится хранить три вида номенклатуры вместо одного.
--
-- ── Зачем ───────────────────────────────────────────────────────────────────
--
-- Синк тянет только ингредиенты, поэтому блюда и полуфабрикаты в каталог не
-- попадают, а строки актов на них остаются без `ingredient_id`. Пересорт таким
-- строкам недоступен: группу он резолвит через `ingredients.group_id`.
--
-- На проде это 193 строки из 2476: 132 полуфабриката, 53 блюда и 8 ингредиентов
-- (см. #531).
--
-- ── Что мешало просто дописать импорт ───────────────────────────────────────
--
-- Два ограничения схемы.
--
-- 1. `ingredients.kind` есть, а у `ingredient_groups` — нет. Категории блюд
--    попали бы в дерево ингредиентов: страница фильтрует по виду позиции, но
--    не группы.
--
-- 2. Обе таблицы уникальны по `(account_id, external_id)`, без вида. В Quick
--    Resto идентификаторы уникальны внутри класса — это прямо сказано в
--    комментарии нашего же клиента, и дедуп в `listNomenclatureTreeItems`
--    сделан по паре класс+id. Значит блюдо и ингредиент могут однажды получить
--    один и тот же числовой id, и upsert МОЛЧА перезапишет одну позицию
--    номенклатуры другой.
--
--    В сегодняшних данных столкновений нет: 67 проверенных идентификаторов трёх
--    классов не пересекаются, и по тому, как они перемежаются (ингредиенты
--    3192–3227, блюда 649/2606/3205, полуфабрикат 517), последовательность в QR
--    похожа на общую. Но «сегодня не пересеклись» — не гарантия, а цена ошибки
--    здесь тихая порча каталога, которую заметят не сразу.
--
-- Поэтому ключ становится тройкой `(account_id, kind, external_id)`.
--
-- ── Что это не меняет ───────────────────────────────────────────────────────
--
-- Каталоги разводятся как разделы интерфейса, а не как отдельные таблицы. На
-- `ingredients` завязаны семь внешних ключей из шести таблиц (строки актов,
-- позиции пересорта, правила исключений, поставщики, журнал, движения
-- пересчёта), на `ingredient_groups` — ещё три, включая
-- `inventory_result_resorts.group_id`. Разводить хранение значило бы учить их
-- всех ссылаться на три каталога; при общей таблице с видом они продолжают
-- работать как есть, а пересорт для блюд заводится без переделки его модели.

-- ── 1. Вид у групп ──────────────────────────────────────────────────────────
--
-- Существующие группы — ингредиентные, поэтому default совпадает с backfill'ом.

alter table public.ingredient_groups
  add column if not exists kind public.nomenclature_kind_enum not null default 'ingredient';

comment on column public.ingredient_groups.kind is
  'Вид номенклатуры, к которому относится категория. Разделяет деревья категорий ингредиентов, блюд и полуфабрикатов в одной таблице.';

-- ── 2. Ключ с учётом вида ───────────────────────────────────────────────────
--
-- Пересоздаём уникальные ограничения. Сначала проверяем, что тройка уже
-- уникальна — если в данных вдруг есть дубли, лучше упасть здесь, чем потерять
-- их молча при создании ограничения.

do $check$
declare v_dupes int;
begin
  select count(*) into v_dupes from (
    select account_id, kind, external_id
      from public.ingredients
     where external_id is not null
     group by 1,2,3 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'ingredients: % дублей по (account_id, kind, external_id)', v_dupes;
  end if;

  select count(*) into v_dupes from (
    select account_id, kind, external_id
      from public.ingredient_groups
     where external_id is not null
     group by 1,2,3 having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'ingredient_groups: % дублей по (account_id, kind, external_id)', v_dupes;
  end if;
end
$check$;

alter table public.ingredients        drop constraint if exists ingredients_external_unique;
alter table public.ingredient_groups  drop constraint if exists ingredient_groups_external_unique;

alter table public.ingredients
  add constraint ingredients_external_unique unique (account_id, kind, external_id);
alter table public.ingredient_groups
  add constraint ingredient_groups_external_unique unique (account_id, kind, external_id);

-- ── 3. Индексы под выборку каталога по виду ─────────────────────────────────
--
-- Страницы каталога и синк всегда фильтруют по виду; без CONCURRENTLY, как
-- требует прогон миграций одной транзакцией (см. CLAUDE.md).

create index if not exists ingredients_account_kind_idx
  on public.ingredients (account_id, kind);
create index if not exists ingredient_groups_account_kind_idx
  on public.ingredient_groups (account_id, kind);

-- ── 4. Типы связей с внешней системой ───────────────────────────────────────
--
-- `external_entity_links` ограничен списком типов, и блюда с полуфабрикатами
-- туда не входят. Их связи должны храниться под своими типами: ключ таблицы —
-- `(account_id, provider, entity_type, external_id)`, и без разделения по типу
-- ссылка на блюдо затёрла бы ссылку на ингредиент с тем же id.

alter table public.external_entity_links
  drop constraint if exists external_entity_links_entity_type_check;

alter table public.external_entity_links
  add constraint external_entity_links_entity_type_check check (
    entity_type = any (array[
      'venue', 'role', 'staff',
      'ingredient', 'ingredient_group',
      'dish', 'dish_group',
      'semi_finished', 'semi_finished_group',
      'store', 'inventory_document'
    ]::text[])
  );
