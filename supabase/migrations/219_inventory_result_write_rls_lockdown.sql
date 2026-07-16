-- F1 (аудит прав инвентаризации): закрыть прямой PostgREST-write в обход server
-- actions, аудита и статус-локов.
--
-- Все легитимные записи по актам инвентаризации и их итогам идут ТОЛЬКО через
-- server actions, которые используют admin-клиент (service_role — BYPASSRLS).
-- Клиент (роль `authenticated`) писать в эти таблицы напрямую через REST-API не
-- должен: иначе держатель `manage_documents` / `adjust_results` мог бы raw-запросом
-- менять факт/разницу/исключения/статус/финализацию — МИНУЯ проверку прав,
-- статус-локи (recount_pending / finalized / processed) и запись в журнал
-- (`inventory_result_events` + `log_audit`).
--
-- Реальная экспозиция (проверено на проде через role_table_grants):
--   documents, document_items          — у authenticated только SELECT-грант
--                                        (write и так блокировался; чистим политику
--                                         как defense-in-depth);
--   inventory_result_resorts,
--   inventory_result_resort_items,
--   inventory_result_exclusion_rules   — у authenticated есть INSERT/UPDATE/DELETE:
--                                        менеджер с adjust_results мог raw-REST'ом
--                                        вставлять правила «исключать всегда» и
--                                        править пересорты БЕЗ логирования;
--   inventory_result_events            — у authenticated есть INSERT: можно было
--                                        подделывать записи журнала (аудит-трейл).
--
-- Двойная защита: снимаем write-политики RLS И отзываем write-гранты. SELECT
-- (чтение через RLS + realtime) не трогаем; service_role (server actions) не
-- затронут. Проверено: клиентских (browser) записей в эти таблицы нет — все
-- мутации в src/app/(dashboard)/inventory/actions.ts и actions-shared.ts идут
-- через admin.

-- 1) RLS write-политики (ALL / INSERT / UPDATE / DELETE) — убираем, SELECT оставляем.
drop policy if exists "documents_insert"        on public.documents;
drop policy if exists "documents_update_manage" on public.documents;
drop policy if exists "documents_delete"        on public.documents;
drop policy if exists "document_items_write_manage" on public.document_items;
drop policy if exists "inventory_result_resorts_write"         on public.inventory_result_resorts;
drop policy if exists "inventory_result_resort_items_write"    on public.inventory_result_resort_items;
drop policy if exists "inventory_result_exclusion_rules_write" on public.inventory_result_exclusion_rules;
drop policy if exists "inventory_result_events_insert"         on public.inventory_result_events;

-- 2) Табличные write-гранты — отзываем у authenticated/anon (пишет только
--    service_role). Идемпотентно: где гранта нет, REVOKE — no-op.
revoke insert, update, delete on public.documents                         from authenticated, anon;
revoke insert, update, delete on public.document_items                    from authenticated, anon;
revoke insert, update, delete on public.inventory_result_resorts          from authenticated, anon;
revoke insert, update, delete on public.inventory_result_resort_items     from authenticated, anon;
revoke insert, update, delete on public.inventory_result_exclusion_rules  from authenticated, anon;
revoke insert, update, delete on public.inventory_result_events           from authenticated, anon;
