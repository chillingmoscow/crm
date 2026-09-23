-- Удалить колонки инвентаризации, которые только пишутся и никем не читаются.
--
-- Каждая проверена по всем каналам чтения: TS (включая select("*") и строковые
-- select-списки), SQL-функции, триггеры, RLS-политики, индексы, вьюхи,
-- supabase/tests, seed.sql и docs/handbook. Отдельно проверено на проде, что на
-- них не ссылается ни один объект БД.
--
-- Почему это не просто уборка. Мёртвая колонка рядом с живой — приглашение
-- прочитать не ту: у пересорта лежали source_shortfall_sum и
-- residual_shortfall_sum, отличающиеся одним словом, и только вторая
-- участвовала в расчётах.
--
-- documents.qr_payload — сырой ответ Quick Resto по акту. Пять писателей, ни
--   одного читателя; комментарий в sync.ts обещал «для дальнейшего
--   использования», которое так и не наступило. На проде 1 МБ.
-- documents.submitted_at / submitted_by — кто и когда сдал акт. Пишутся при
--   сдаче и нигде не показываются: в интерфейсе эту роль выполняет журнал
--   акта (inventory_result_events) и колонка assigned_to.
-- document_items.result_payload — «диагностический сырец последнего ответа
--   QR». Когда расчётные поля пришли, пишется ТОЙ ЖЕ переменной, что и
--   raw_payload строкой выше, то есть хранит его дубль; когда не пришли —
--   пустой объект. То есть колонка кодировала ровно один бит: принёс ли
--   ЭТОТ импорт построчный расчёт. Бит настоящий и из соседних колонок не
--   выводится: resolveLineResult при пустом ответе сохраняет прежние
--   calculated_amount / difference_sum («пустой ответ ничего не значит»),
--   а documents.results_has_line_amounts — про акт целиком, не про строку.
--   Но за всё время его никто ни разу не прочитал, поэтому колонка мёртвая:
--   2.5 МБ на проде ради сигнала, который некому принять.
-- inventory_result_resorts.source_shortfall_sum / source_surplus_sum — суммы
--   до зачёта. Выводятся из inventory_result_resort_items.source_difference_sum;
--   в управленческий итог не входят, снимок итогов (миграция 227) их даже не
--   замораживает.
-- inventory_result_resorts.suggestion_source / suggestion_confidence —
--   происхождение подсказки. Процент уверенности пользователь видит на живой
--   карточке подсказки ДО применения (results-table.tsx), и берётся он не
--   отсюда, а из самой подсказки. В payload событий suggestion_applied /
--   suggestion_dismissed confidence тоже пишется, но журнал его не рисует.
--   Из этих колонок не читает никто. suggestion_source единственная доезжала
--   до клиента в props — и там не рисовалась.
-- inventory_result_resorts.metadata — { itemIds } пересорта. Дубль
--   inventory_result_resort_items.document_item_id и payload события
--   resort_created.
-- inventory_result_resort_items.snapshot — строка акта на момент пересорта.
--   Не читается, и пересчёт пересортов после импорта из QR её даже не
--   обновляет, так что после первой же синхронизации она врёт.
--
-- CHECK на suggestion_source и FK submitted_by → profiles уезжают вместе со
-- своими колонками, отдельных drop им не нужно.

alter table public.documents
  drop column if exists qr_payload,
  drop column if exists submitted_at,
  drop column if exists submitted_by;

alter table public.document_items
  drop column if exists result_payload;

alter table public.inventory_result_resorts
  drop column if exists source_shortfall_sum,
  drop column if exists source_surplus_sum,
  drop column if exists suggestion_source,
  drop column if exists suggestion_confidence,
  drop column if exists metadata;

alter table public.inventory_result_resort_items
  drop column if exists snapshot;
