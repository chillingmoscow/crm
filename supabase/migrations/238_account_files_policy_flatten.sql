-- Политика account_files_select перестаёт раскрывать RLS шести соседних таблиц.
--
-- ── Что не так ──────────────────────────────────────────────────────────────
--
-- Предикат `account_files_select` — это семь ветвей OR, и шесть из них EXISTS по
-- другим таблицам: transaction_attachments, counterparty_attachments,
-- legal_entity_attachments, ingredient_groups, ingredients и связка
-- ingredients × document_items × documents.
--
-- У каждой из этих таблиц своя RLS, и она раскрывается внутрь предиката
-- рекурсивно: ingredients тянет за собой document_items, тот — documents, у
-- documents свои десять вызовов has_permission. В итоге план одного
-- `select count(*)` содержит 173 InitPlan-узла.
--
-- Замер на проде до правки:
--   select count(*) from account_files   →  планирование 30,1 мс, выполнение 48,1 мс
--
-- В таблице при этом 113 строк, а пять из шести ветвей ведут в таблицы, где
-- вообще ноль записей. То есть 78 мс — цена конструкции, а не данных, и платит
-- её каждая страница с вложениями: карточки контрагентов и юрлиц, база знаний,
-- фотографии позиций в акте.
--
-- ── Что делаем ──────────────────────────────────────────────────────────────
--
-- Шесть EXISTS сворачиваются в одну SECURITY DEFINER функцию, возвращающую
-- набор идентификаторов файлов. Она вычисляется один раз на запрос, а RLS
-- соседних таблиц внутрь не раскрывается — именно её рекурсивное раскрытие и
-- давало дерево на 173 узла.
--
-- Проверки `account_id` и прав внутри функции сохранены дословно: они и раньше
-- стояли в каждой ветви явно, а RLS соседних таблиц была поверх них избыточна.
-- Ветвь `uploaded_by = auth.uid()` осталась в самой политике — это дешёвая
-- построчная проверка, ей функция не нужна.
--
-- Функция живёт в схеме `private` (заведена миграцией 237), которой нет в
-- `PGRST_DB_SCHEMAS`: это внутренний помощник политики, а не эндпойнт.
--
-- ── Чем доказана равнозначность ─────────────────────────────────────────────
--
-- На проде, в откатанной транзакции, для каждого из 21 живого пользователя
-- собран полный набор видимых файлов до и после замены политики:
--
--   видно было 227 пар, видно стало 227, пропало 0, прибавилось 0
--   по пользователям: 110/110, 60/60, 57/57 (остальные не видят файлов ни там, ни там)
--
-- После замены: планирование 0,17 мс, выполнение 18,0 мс.

create or replace function private.my_visible_file_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with ctx as (
    select public.get_active_account_id() as acc, auth.uid() as usr
  )
  select ta.file_id
    from public.transaction_attachments ta
    join public.transactions t on t.id = ta.transaction_id
    cross join ctx
   where t.account_id = ctx.acc
     and public.has_permission('finance.view_attachments')
  union
  select ca.file_id
    from public.counterparty_attachments ca
    join public.counterparties c on c.id = ca.counterparty_id
    cross join ctx
   where c.account_id = ctx.acc
     and public.has_permission('finance.view_attachments')
  union
  select la.file_id
    from public.legal_entity_attachments la
    join public.legal_entities le on le.id = la.legal_entity_id
    cross join ctx
   where le.account_id = ctx.acc
     and public.has_permission('org.view_legal_entities')
  union
  select ipg.primary_image_file_id
    from public.ingredient_groups ipg
    cross join ctx
   where ipg.account_id = ctx.acc
     and ipg.primary_image_file_id is not null
     and public.has_permission('inventory.view_products')
  union
  select ip.primary_image_file_id
    from public.ingredients ip
    cross join ctx
   where ip.account_id = ctx.acc
     and ip.primary_image_file_id is not null
     and public.has_permission('inventory.view_products')
  union
  -- Исполнитель видит фото позиций в акте, который назначен на него. Раньше
  -- сюда добавлялась ещё и RLS documents/document_items; она избыточна, потому
  -- что `d.assigned_to = auth.uid()` и так один из тех случаев, при которых
  -- documents_select показывает акт.
  select ip.primary_image_file_id
    from public.ingredients ip
    join public.document_items idi on idi.ingredient_id = ip.id
    join public.documents d on d.id = idi.document_id
    cross join ctx
   where ip.account_id = ctx.acc
     and ip.primary_image_file_id is not null
     and d.assigned_to = ctx.usr
     and public.has_permission('inventory.fill_assigned_documents')
$fn$;

grant execute on function private.my_visible_file_ids() to authenticated, anon, service_role;

alter policy account_files_select on public.account_files
using (
  account_id = (select public.get_active_account_id())
  and (
    uploaded_by = (select auth.uid())
    or id in (select private.my_visible_file_ids())
  )
);
