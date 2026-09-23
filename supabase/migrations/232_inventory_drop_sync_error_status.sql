-- Убрать статус акта 'sync_error' — недостижимое состояние.
--
-- Статус объявлен ещё в 122, участвует в сортировке (212, 216), нарисован
-- бейджем, предлагается в фильтре списка и блокирует смену исполнителя и
-- проверяющего. При этом НИ ОДНА строка кода его не выставляет: на проде
-- 0 актов из 29, и появиться им неоткуда.
--
-- Пользователю это видно: в фильтре «Статус» есть пункт «Ошибка
-- синхронизации», который всегда даёт пустой список.
--
-- Почему убираем, а не начинаем выставлять. `status` — это ЖИЗНЕННЫЙ ЦИКЛ
-- акта (кто считает, сдан ли, проведён ли). Сбой синхронизации к этому циклу
-- ортогонален: перезаписав статус, мы стёрли бы состояние работы исполнителя
-- (акт «в работе» с наполовину заполненной формой стал бы «ошибкой»).
-- Для QR-состояний рядом со статусом в модуле уже есть правильный образец —
-- отдельная колонка documents.qr_unprocessed_at (миграция 224). Если сбои
-- синхронизации понадобится показывать, делать это надо так же, отдельным
-- признаком, а не значением статуса.
--
-- Удалить метку из enum на месте нельзя (ALTER TYPE ... DROP VALUE в
-- PostgreSQL нет), поэтому подменяем тип целиком. Порядок меток сохранён,
-- включая recount_pending, добавленный позже через ADD VALUE (на проде он
-- стоит с enumsortorder 4.5 — здесь это просто пятая позиция).
--
-- Если в базе вдруг найдётся акт с этим статусом, USING-приведение упадёт и
-- миграция откатится целиком. Это осознанно: молча превращать такой акт в
-- 'synced' значило бы потерять факт, которого мы не ждали.

alter table public.documents
  alter column status drop default;

alter type public.inventory_document_status_enum
  rename to inventory_document_status_enum_old;

create type public.inventory_document_status_enum as enum (
  'synced',
  'assigned',
  'in_progress',
  'ready_for_review',
  'recount_pending',
  'processed',
  'results_blocked'
);

alter table public.documents
  alter column status type public.inventory_document_status_enum
  using status::text::public.inventory_document_status_enum;

alter table public.documents
  alter column status set default 'synced';

drop type public.inventory_document_status_enum_old;

-- list_inventory_documents сравнивает статус как текст
-- (`case d.status::text when 'sync_error' then 8`), поэтому ветка просто
-- перестаёт совпадать и функцию пересоздавать не нужно. Мёртвую ветку уберём
-- вместе со следующей правкой этой функции, чтобы не переписывать 230 строк
-- ради одной строки.
