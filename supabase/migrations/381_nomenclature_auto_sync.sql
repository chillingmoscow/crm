-- Автоматическая сверка номенклатуры Quick Resto.
--
-- Фоновый обработчик (/api/cron/sales-shifts) раз в несколько часов сверяет
-- каталог с Quick Resto для каждого активного подключения. Здесь хранится
-- состояние последнего запуска: когда он начался (метка захвата, чтобы два
-- тика не взяли один аккаунт), когда последний раз прошёл успешно и чем
-- закончился (итоги и предупреждения для страницы номенклатуры).
--
-- Раньше время синхронизации бралось как max(ingredients.synced_at), но сверка
-- больше не переписывает неизменённые позиции, и эта метка перестала бы
-- двигаться.
--
-- Колонки читает только сервер admin-клиентом; новых прав не выдаём.

alter table public.integration_connections
  add column if not exists nomenclature_sync_started_at timestamptz,
  add column if not exists nomenclature_synced_at timestamptz,
  add column if not exists nomenclature_sync_result jsonb;

comment on column public.integration_connections.nomenclature_sync_started_at is
  'Когда начался последний запуск сверки номенклатуры (ручной или по расписанию). Обработчик берёт подключение, если отсюда прошло больше интервала.';
comment on column public.integration_connections.nomenclature_synced_at is
  'Когда сверка номенклатуры последний раз завершилась успешно.';
comment on column public.integration_connections.nomenclature_sync_result is
  'Итоги последнего запуска сверки: ok, error, added, updated, archived, restored, warnings[], trigger, finishedAt.';
