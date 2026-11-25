# Контрагенты, этап 3: сертификаты и лицензии с напоминаниями — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** У контрагента — список сертификатов соответствия, деклараций и лицензий на алкоголь со сроком действия; за 30 и за 7 дней до конца срока всем, у кого есть доступ к контрагентам, приходит уведомление; у пункта меню «Контрагенты» — цифра истекающих и просроченных; в списке — фильтр.

**Spec:** `docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md`, раздел 6 (с правкой Павла: отдельного права на напоминания нет — получают все с `finance.view_counterparties`).

## Решения

- Таблица `counterparty_certificates` (тенантность по `docs/CONVENTIONS.md`: `account_id`, `unique (account_id, id)`, композитный FK на `counterparties (account_id, id) on delete cascade`). Дочерние записи: удаляются насовсем, без архива.
- Поля: `kind` (`conformity_certificate` «Сертификат соответствия», `conformity_declaration` «Декларация о соответствии», `alcohol_license` «Лицензия на алкоголь», `other` «Другое»), `number`, `product` («на какой товар»), `valid_from`, `valid_until` (пусто — бессрочный), `file_id` → один из документов этого контрагента (`account_files`, `on delete set null`), `note`, `notified_30_for`, `notified_7_for`, автор/время.
- Скан не загружается отдельно: выбирается из уже загруженных «Документов» контрагента — один файл не живёт в двух местах.
- RLS: чтение — `finance.view_counterparties`, запись — `finance.manage_counterparties`, всегда в активном аккаунте; `(select …)`-обёртки.
- Журнал: server actions пишут `finance.counterparty_certificate.created|updated|deleted` на контрагента (видно во вкладке «Журнал»).
- Напоминания: `enqueue_counterparty_certificate_notifications()` (SECURITY DEFINER, execute только `service_role`, отзыв у `anon/authenticated` с проверкой). Порог 30 дней и порог 7 дней, каждый — один раз на текущую `valid_until` (`notified_30_for` / `notified_7_for`); если запись сразу попала в 7 дней — одно уведомление, отмечаются оба порога. Просроченные без уведомления о 7 днях — одно уведомление «просрочен». Получатели — активные участники заведений аккаунта с ролью, где выдано `finance.view_counterparties`. Тип `finance.certificate_expiring`, категория `finance`, ссылка `/finance/counterparties/<id>?tab=documents`.
- Запуск: из существующего ежедневного cron `/api/cron/finance-recurring` (00:05 МСК) — новый пункт на хосте не нужен.
- Цифра в меню: число сертификатов живых контрагентов с `valid_until <= сегодня + 30` (включая просроченные), видна с `finance.view_counterparties`; считается в layout, обновляется при возврате на вкладку и после правки сертификата.

## Задачи

1. **Помощники** `src/lib/finance/certificates.ts` + тесты: `CERTIFICATE_KINDS`, `certificateStatus(validUntil, today) → { tone: "expired"|"expiring"|"ok"|"none", label }` («Просрочен», «Истекает сегодня», «Истекает через N дн.»), `CERTIFICATE_ALERT_DAYS = 30`.
2. **Миграция 388** `counterparty_certificates` + RLS + grants + функция напоминаний + проверки прав; применить локально в транзакции и по-настоящему, проверить: вставка → функция шлёт 1 уведомление получателю с правом, повторный запуск — 0, смена даты — снова.
3. **Server actions** `src/lib/finance/certificates-actions.ts`: `listCounterpartyCertificates`, `createCertificate`, `updateCertificate`, `deleteCertificate` (проверка, что `file_id` — документ этого контрагента; `.select("id")` против тихих 0 строк; журнал; `revalidatePath`), `countCertificateAlerts()`.
4. **UI карточки**: блок «Сертификаты и лицензии» во вкладке «Документы» над файлами: строки (вид, №, товар, срок, бейдж статуса, открыть файл), панель добавления/правки (`EditDrawer`), удаление с подтверждением. Вкладка открывается по `?tab=documents`.
5. **Список и меню**: пометка в подписи строки («Сертификат истекает» / «Сертификат просрочен»), фильтр «Сертификаты: истекают или просрочены»; бейдж у «Контрагенты» в сайдбаре; тип уведомления в `registry.ts`; вызов функции в cron `finance-recurring`.
6. **Справка** `docs/handbook/finance/counterparties.md` и проверка: tsc, lint, тесты, браузер.
