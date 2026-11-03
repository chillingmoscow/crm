# Задача 2: привязка склада к подразделению (схема)

## Сделано
- `supabase/migrations/307_store_department_binding.sql`: колонки `stores.department_id`, `stores.department_scope` (`unset|shared|department`), CHECK «scope=department <=> department_id not null», индекс, BEFORE-триггер (тенантность + возврат в `unset`), таблица `store_department_history` (RLS, select по `inventory.view_results`), AFTER-триггер истории, RPC `set_store_department` (право `inventory.manage_stores`).
- `supabase/tests/store_department_binding.sql`: 6 случаев брифа + дефолт, RPC-проверки (некорректные комбинации, чужое подразделение, права, гранты, отказ официанту).

## Отклонения от брифа (важно)
1. **`departments` не имеет `account_id`** (колонку снимала миграция 172; подразделение принадлежит заведению через `venue_id`). Композитный FK `(account_id, department_id)` невозможен, и `unique (account_id, id)` на departments добавлять нечего. Сделано: обычный FK `department_id -> departments(id) on delete set null` + BEFORE-триггер проверяет `departments.venue_id -> venues.account_id = stores.account_id` ("Подразделение относится к другому аккаунту"). Соответственно нет композитного индекса, только `(department_id) where not null`.
2. Право `inventory.manage_stores` (по ruling 2).
3. История пишется AFTER-триггером на `stores`, а не из RPC: `authenticated` не имеет UPDATE на `stores`, но service_role имеет, и триггер ловит любой путь, включая обнуление при удалении подразделения. RPC возвращает id склада (повтор ничего не пишет).

## RED
`psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/store_department_binding.sql` до миграции: `ERROR: column "department_scope" does not exist`.

## GREEN
После `pnpm db:reset` (миграция 307 применена): тот же запуск -> `store_department_binding: OK`, 0 ошибок, повторный запуск тоже чистый (откат). Случай 6 проходит именно через BEFORE-триггер (ruling 1 подтверждён: удаление подразделения переводит склад в `unset`, в истории запись old_scope=department, new_scope=unset).

## Advisors
`supabase db advisors --local`: на уровне warn ничего. На уровне info только ожидаемый «unused index» для `store_department_history_actor_idx` (и аналогичные для новых индексов).

## Самопроверка / замечания
- Название старого подразделения при его удалении в истории пустое (строка уже удалена при срабатывании RI), сохраняется id.
- Совпадение venue подразделения и `local_venue_id` склада не проверяется (в брифе не требовалось).
- `docs/handbook` не обновлялся: пользовательского эффекта пока нет (UI в следующей задаче).

## Fix round 1
- Finding 1: BEFORE-триггер требует `local_venue_id is not null` и `departments.venue_id = local_venue_id`; ошибки: «Склад не привязан к заведению…» и «Подразделение относится к другому заведению, не к заведению склада».
- Finding 2: тот же триггер сбрасывает `department_id` (и scope в `unset`) при обнулении или смене `local_venue_id`, включая удаление заведения через FK. Триггеры на stores переведены с `UPDATE OF <cols>` на общий UPDATE (иначе сброс, сделанный BEFORE-триггером при обнулении venue, не попадал бы в историю).
- Finding 3: при записи истории имя подразделения берётся из `departments`, а если строки уже нет (удалено) — из последней записи истории, где оно было привязано. Тест проверяет `old_department_name` после удаления.
- Тест: добавлены 3b (подразделение другого заведения), 3c (склад без заведения), 7 (venue обнулён), 8 (venue сменён), 8b (заведение удалено), 9 (имя в истории).
- Данные: существующие склады все `unset`, конфликтов нет.
- Команда: `pnpm db:reset` затем `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/store_department_binding.sql` -> `store_department_binding: OK`, ошибок нет; advisors по новым объектам чисты.

## Fix round 2
- Finding 1: BEFORE UPDATE OF venue_id триггер на `departments` (`private.departments_venue_move_guard`) отклоняет перенос в другое заведение, пока есть привязанные склады («Подразделение нельзя перенести в другое заведение, пока к нему привязаны склады: сначала отвяжите склады»). Привязки не сбрасываются молча. Проверил: в app (src) подразделения между заведениями не переносятся (только старые миграции 166/169), поток не ломается.
- Finding 2: в тестах 5c, 5d, 5e, 5g проверяются тексты ошибок.
- Finding 3: у `store_department_history.changed_by` снят FK (и его индекс); актор best-effort.
- Новый тест 10/10b: привязанное подразделение не переносится (venue не изменился), свободное переносится, после отвязки склада перенос разрешён.
- Команда: `pnpm db:reset`, затем `psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/store_department_binding.sql` -> `store_department_binding: OK`; advisors (warn) по новым объектам пусты.

## Fix round 3
- `private.departments_venue_move_guard()` теперь SECURITY DEFINER (с `set search_path = public, pg_catalog`): `exists` по `stores` видит все строки, а не срез `stores_select`.
- Новый тест 11 под ролью `authenticated`: пользователь с `people.manage_roles`/`view_roles` без inventory-прав. Предпосылка в тесте проверяет, что склад ему не виден (`select` по stores пуст); затем перенос привязанного подразделения должен быть отклонён с текстом «Подразделение нельзя перенести…».
- RED: с invoker-версией тест падал: `FAIL 11: bound department moved by a user who cannot see the store` (предпосылка выполнялась). GREEN после правки: `store_department_binding: OK`; advisors (warn) по новым объектам пусты.
- `stores_department_guard` оставил INVOKER осознанно: он читает `departments` только в путях, где пишет DEFINER-RPC или service_role (у authenticated нет UPDATE на `stores`), RLS там не мешает; при невидимой строке он закрывается ошибкой, а не пропускает.
