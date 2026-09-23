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
-- В таблице при этом 113 строк, а пять из шести смежных таблиц вообще пусты.
-- То есть 78 мс — цена конструкции, а не данных, и платит её каждая страница с
-- вложениями: карточки контрагентов и юрлиц, база знаний, фотографии позиций.
--
-- ── Что делаем и почему именно так ──────────────────────────────────────────
--
-- Шесть EXISTS сворачиваются в одну функцию, возвращающую набор идентификаторов
-- файлов. Ключевые два решения:
--
--   * `SECURITY INVOKER` (по умолчанию) — RLS родительских таблиц продолжает
--     применяться внутри функции. Границы доступа сохраняются ПО ПОСТРОЕНИЮ, а
--     не переписыванием предикатов.
--   * `language plpgsql` — тело такой функции не инлайнится в вызывающий
--     запрос. Именно поэтому раскрытие чужих политик не попадает в план
--     account_files, ради чего всё и затевалось.
--
-- Первая версия этой миграции была SECURITY DEFINER, и это была ошибка с дырой
-- в доступе. Рассуждение звучало убедительно — «проверки account_id и прав уже
-- стоят в каждой ветви явно, RLS соседей поверх них избыточна» — и было неверно
-- для трёх ветвей:
--
--   * `transactions_select` ограничивает ещё и активным юрлицом, активным
--     заведением, правом finance.view_transactions и soft-delete (миграция 046);
--   * `counterparties_select` требует finance.view_counterparties и прячет
--     удалённых (миграция 046);
--   * архивные юрлица видны только владельцу аккаунта (миграция 200).
--
-- Обход этих правил открыл бы метаданные и ссылки на вложения тем, кому сам
-- родительский объект не виден.
--
-- Соблазнительная альтернатива — оставить SECURITY DEFINER и повторить внутри
-- предикаты родителей. Она быстрее (18 мс против 31), но копирует правила
-- доступа во второе место: любая будущая правка `transactions_select` молча
-- разъедется с копией здесь. Это ровно тот механизм, который и породил ошибку,
-- поэтому выбран более медленный, но самосогласованный вариант.
--
-- Явные проверки `account_id` внутри ветвей убраны: тенантность родителей
-- обеспечивает их собственная RLS, а тенантность самого файла проверяется в
-- политике. Дублировать её здесь значило бы вернуться к той же развилке.
--
-- ── Чем доказана равнозначность ─────────────────────────────────────────────
--
-- На проде, в откатанной транзакции, для каждого из 21 живого пользователя
-- собран полный набор видимых файлов до и после замены политики:
--
--   видно было 227 пар, видно стало 227, пропало 0, прибавилось 0
--   по пользователям: 110/110, 60/60, 57/57
--
-- Оговорка, без которой это доказательство переоценили бы: три таблицы
-- вложений пусты, поэтому данные не могли поймать расхождение в тех самых
-- ветвях. Их корректность держится на SECURITY INVOKER, то есть на построении,
-- а не на замере.
--
-- После замены: планирование 0,14 мс, выполнение 31 мс.

create or replace function private.my_visible_file_ids()
returns setof uuid
language plpgsql
stable
as $fn$
begin
  return query
  select ta.file_id
    from public.transaction_attachments ta
    join public.transactions t on t.id = ta.transaction_id
   where public.has_permission('finance.view_attachments')
  union
  select ca.file_id
    from public.counterparty_attachments ca
    join public.counterparties c on c.id = ca.counterparty_id
   where public.has_permission('finance.view_attachments')
  union
  select la.file_id
    from public.legal_entity_attachments la
    join public.legal_entities le on le.id = la.legal_entity_id
   where public.has_permission('org.view_legal_entities')
  union
  select ipg.primary_image_file_id
    from public.ingredient_groups ipg
   where ipg.primary_image_file_id is not null
     and public.has_permission('inventory.view_products')
  union
  select ip.primary_image_file_id
    from public.ingredients ip
   where ip.primary_image_file_id is not null
     and public.has_permission('inventory.view_products')
  union
  -- Исполнитель видит фото позиций в акте, назначенном на него. RLS documents
  -- и document_items здесь по-прежнему работает — функция INVOKER.
  select ip.primary_image_file_id
    from public.ingredients ip
    join public.document_items idi on idi.ingredient_id = ip.id
    join public.documents d on d.id = idi.document_id
   where ip.primary_image_file_id is not null
     and d.assigned_to = auth.uid()
     and public.has_permission('inventory.fill_assigned_documents');
end
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
