# Сверка остатка счёта с банком — план

> Исполнение: native (в этой сессии), по задачам ниже.

**Goal:** на карточке счёта ввести остаток банка на дату, увидеть разницу с остатком по операциям, хранить историю сверок.

**Architecture:** миграция 374 (после #691: нужен `accounts.timezone` из 370) — таблица `bank_account_reconciliations`, функция остатка на дату, триггер, который сам считает и фиксирует расчётный остаток. Server actions в `src/lib/finance/bank-reconciliations.ts`, чистая логика (разница, подсказки, период поиска) в `bank-reconciliation.ts` с тестами. UI — секция и панель на карточке счёта.

**Spec:** `docs/superpowers/specs/2026-11-21-bank-reconciliation-design.md`

## Global Constraints

- Граница дня — пояс аккаунта (`accounts.timezone`), как в `finance_transactions_page` (371 в #691): по день D включительно = `date < начало D+1 в поясе`.
- `set search_path = public, pg_catalog` во всех функциях; `(select auth.uid())` в политиках; GRANT/REVOKE проверяются в миграции.
- Журнал: `finance.bank_account_reconciliation.created` / `.deleted`, сущность `bank_account`, через `writeAuditEvent` после проверенной записи.
- Деньги с копейками (`formatMoney(..., currency, 2)`), минус U+2212.

## Review Focus

- Сверка на дату раньше контрольного остатка Adesk → понятный отказ, не неверная цифра.
- Пользователь без доступа к заведению операций — расчётный остаток всё равно полный (считает база, не RLS операций).
- Подделка `calculated_balance` / `created_by` прямым insert через API → триггер перезаписывает.
- Сверка в будущем / архивный счёт → отказ.
- Перевод между своими счетами входит в оба счёта с нужным знаком.

## Tasks

1. **Миграция 374** — таблица, RLS (select / insert / delete, без update), `private.bank_account_day_end(account_id, date)`, `private.bank_account_turnover_since(account_id, bank_account_id, since)` (definer), `public.bank_account_balance_at(bank_account_id, date)` (invoker), `public.bank_account_reconciliation_history(bank_account_id)`, триггер `bank_account_reconciliation_prepare`. Проверка в транзакции с откатом на локальной БД: остаток на дату = баланс − операции после, переводы, якорь, подделка полей.
2. **Логика + тесты** — `src/lib/finance/bank-reconciliation.ts`: `reconciliationDiff`, `reconciliationStatus`, `searchWindow`, `suspectHint`; `bank-reconciliation.test.mts`.
3. **Server actions** — `getBalanceAt`, `listReconciliations`, `getReconciliationSearch`, `createReconciliation`, `deleteReconciliation`; журнал и фразы в `format.tsx`.
4. **UI** — секция «Сверка с банком» на «Основном» + панель «Сверка с банком» (дата, остаток, результат, поиск расхождения) + удаление с подтверждением.
5. **Справка** `docs/handbook/finance/accounts.md`, tsc + lint + тесты, PR (base main, мержить после #691).
