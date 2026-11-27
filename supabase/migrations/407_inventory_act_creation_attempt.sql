-- Создание акта инвентаризации из Sheerly: повтор после сбоя продолжает тот же акт.
--
-- Акт создаётся в Quick Resto в несколько шагов: сам акт, затем позиции по
-- одной (`items/create`). Если на середине оборвалась сеть или Quick Resto
-- ответил ошибкой, акт в QR уже есть. Повторное нажатие «Создать акт» должно
-- дополнить его, а не завести второй такой же. Панель создаёт id попытки при
-- открытии и присылает его с каждой отправкой; по нему сервер находит акт
-- прошлой попытки.
--
-- Колонка аддитивная и nullable: у актов из синхронизации и из выноса на
-- пересчёт её нет. Уникальность — в пределах аккаунта и только для
-- заполненных значений. Индекс начинается с account_id — так же ищет сервер.

alter table public.documents
  add column if not exists creation_attempt_id uuid;

comment on column public.documents.creation_attempt_id is
  'Id попытки создания акта из Sheerly (панель «Создать акт»). По нему повтор после сбоя продолжает наполнять тот же акт в Quick Resto. У актов из синхронизации — null.';

create unique index if not exists documents_account_creation_attempt_key
  on public.documents (account_id, creation_attempt_id)
  where creation_attempt_id is not null;
