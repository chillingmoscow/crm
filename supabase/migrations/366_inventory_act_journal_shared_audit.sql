-- Журнал акта инвентаризации переходит на общий журнал (audit_logs), как у
-- кандидата (354), сотрудника и должности. Раньше вкладка «Журнал» карточки
-- акта читала inventory_result_events и была видна с правом
-- inventory.view_results. События акта пишутся в audit_logs с самого начала
-- (entity_type = 'inventory_document', action_code = 'inventory.<тип>'), но:
--
--   1. audit_logs_select пускал только с org.view_audit — проверяющий без
--      доступа к общему журналу потерял бы журнал акта. Расширяем единственную
--      permissive-политику OR'ом: события конкретного акта (entity_id задан)
--      читаются и с inventory.view_results — если сам акт виден пользователю
--      (documents_select). Прочие разделы журнала — как были.
--   2. В details не было текста события и названий позиций — по одному коду
--      не понять, какую строку отметили. Дозаполняем из inventory_result_events
--      (сообщение, число событий одной команды).
--   3. Заведение строки бралось из активной сессии, а не из акта: у
--      проверяющего из другого заведения событие уходило не туда. Исправляем
--      на заведение акта.
--   4. Если строка в audit_logs когда-то не записалась (запись была
--      best-effort), добавляем её из inventory_result_events — одну на команду
--      (тот же акт, тип, автор и секунда), как пишет приложение.
--
-- Сопоставление события и строки журнала: тот же акт, тот же код, тот же
-- автор, разница во времени не больше 10 секунд (обе записи делает один
-- server action подряд).

begin;

drop policy if exists "audit_logs_select" on public.audit_logs;
create policy "audit_logs_select"
  on public.audit_logs for select
  using (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('org.view_audit'))
      or (
        entity_type = 'candidate'
        and entity_id is not null
        and action_code like 'candidate.%'
        and (select public.has_permission('people.manage_candidates'))
      )
      or (
        entity_type = 'inventory_document'
        and entity_id is not null
        and action_code like 'inventory.%'
        and (select public.has_permission('inventory.view_results'))
        -- Журнал виден ровно тем, кто видит сам акт: documents_select (RLS
        -- подзапроса) уже учитывает заведение, view_all_venues и
        -- проверяющего из другого заведения (195, 210). Без этого
        -- view_results в одном заведении открывал журналы актов всех
        -- заведений аккаунта.
        and exists (select 1 from public.documents d where d.id = audit_logs.entity_id)
      )
    )
  );

-- 2 + 3. Текст события и заведение акта для уже записанных строк.
with matched as (
  select
    a.id as audit_id,
    d.venue_id,
    (array_agg(e.message order by e.created_at))[1] as message,
    count(e.id) as events
  from public.audit_logs a
  join public.documents d
    on d.id = a.entity_id
   and d.account_id = a.account_id
  left join public.inventory_result_events e
    on e.account_id = a.account_id
   and e.document_id = a.entity_id
   and 'inventory.' || e.event_type = a.action_code
   and e.created_by is not distinct from a.user_id
   and abs(extract(epoch from (e.created_at - a.created_at))) <= 10
  where a.entity_type = 'inventory_document'
    and a.action_code like 'inventory.%'
  group by a.id, d.venue_id
)
update public.audit_logs a
set
  venue_id = coalesce(m.venue_id, a.venue_id),
  details = a.details
    || case
         when m.message is not null and not (a.details ? 'message')
           then jsonb_build_object('message', m.message)
         else '{}'::jsonb
       end
    || case
         when m.events > 1 and not (a.details ? 'count')
           then jsonb_build_object('count', m.events)
         else '{}'::jsonb
       end
from matched m
where a.id = m.audit_id;

-- 4. События без строки в общем журнале — по одной строке на команду.
insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details, created_at)
select
  e.account_id,
  d.venue_id,
  (select p.id from public.profiles p where p.id = e.created_by),
  'inventory.' || e.event_type,
  'inventory_document',
  e.document_id,
  (array_agg(e.payload order by e.created_at))[1]
    || jsonb_build_object('message', (array_agg(e.message order by e.created_at))[1])
    || case when count(*) > 1 then jsonb_build_object('count', count(*)) else '{}'::jsonb end,
  min(e.created_at)
from public.inventory_result_events e
join public.documents d
  on d.id = e.document_id
 and d.account_id = e.account_id
where not exists (
  select 1
  from public.audit_logs a
  where a.account_id = e.account_id
    and a.entity_type = 'inventory_document'
    and a.entity_id = e.document_id
    and a.action_code = 'inventory.' || e.event_type
    and a.user_id is not distinct from e.created_by
    and abs(extract(epoch from (e.created_at - a.created_at))) <= 10
)
-- Автор мог быть удалён из profiles (FK audit_logs.user_id): такую строку
-- пишем без автора, чем теряем событие целиком.
group by e.account_id, d.venue_id, e.created_by, e.event_type, e.document_id, date_trunc('second', e.created_at);

-- 5. Названия позиций для старых строк (новые пишет приложение). Берём id
-- строк из details (itemId, flaggedItemIds, itemIds); у выноса в акт
-- пересчёта строки уже удалены, их названия лежат в productNames.
update public.audit_logs a
set details = a.details
  || jsonb_build_object('item_names', to_jsonb(x.names), 'item_count', x.total)
from (
  select a2.id, (array_agg(di.product_name order by di.product_name))[1:5] as names, count(*) as total
  from public.audit_logs a2
  cross join lateral (
    select jsonb_array_elements_text(
             case when jsonb_typeof(a2.details -> 'flaggedItemIds') = 'array'
                  then a2.details -> 'flaggedItemIds' else '[]'::jsonb end) as item_id
    union
    select jsonb_array_elements_text(
             case when jsonb_typeof(a2.details -> 'itemIds') = 'array'
                  then a2.details -> 'itemIds' else '[]'::jsonb end)
    union
    select a2.details ->> 'itemId' where a2.details ? 'itemId'
  ) ids
  join public.document_items di
    on di.id::text = ids.item_id
   and di.account_id = a2.account_id
  where a2.entity_type = 'inventory_document'
    and a2.action_code like 'inventory.%'
    and not (a2.details ? 'item_names')
  group by a2.id
) x
where a.id = x.id;

update public.audit_logs a
set details = a.details || jsonb_build_object(
  'item_names', (select jsonb_agg(v) from (select v from jsonb_array_elements(a.details -> 'productNames') v limit 5) t),
  'item_count', jsonb_array_length(a.details -> 'productNames')
)
where a.entity_type = 'inventory_document'
  and a.action_code like 'inventory.%'
  and not (a.details ? 'item_names')
  and jsonb_typeof(a.details -> 'productNames') = 'array'
  and jsonb_array_length(a.details -> 'productNames') > 0;

commit;
