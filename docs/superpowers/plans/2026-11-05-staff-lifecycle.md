# Этап 4: жизненный цикл сотрудника — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-чаты, списание бонусов при увольнении, возврат сотрудника через восстановление в Quick Resto и смена должности в зарплате — в Sheerly, чтобы отключить кадровые сценарии n8n.

**Architecture:** Telegram — тонкий серверный клиент Bot API поверх уже настроенного бота (`organization_telegram_settings`), таблица чатов организации и журнал действий; решения (кого приглашать, как читать членство) — чистые функции с тестами. Увольнение расширяется двумя шагами в существующем идемпотентном процессе `staff_terminations`. Возврат — новый процесс по тому же образцу (журнал шагов, аренда, повтор). Смена должности — серверное действие, обновляющее зарплату с датой.

**Tech Stack:** Next.js 15 server actions, Supabase/Postgres, Quick Resto back-office API (существующий клиент), Telegram Bot API, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-05-staff-lifecycle-design.md`

## Global Constraints

- Ветка от `origin/main`, PR `--base main`. Следующая миграция — `313_…` (проверить `ls supabase/migrations | tail`).
- Конвенции миграций из CLAUDE.md: `set search_path = public, pg_catalog` в функциях, `(select auth.uid())` в RLS, композитные `(account_id, id)` ключи и FK, без `CONCURRENTLY`, одна permissive-политика на (role, action).
- Токен бота — только из `organization_telegram_settings.secret` через `decryptSecret` (`src/lib/integrations/crypto`), никогда в логи/ответы/журнал. Чаты: отчёты — `default_chat_id`, приглашения — `candidate_chat_id` (как `telegramDestination`).
- Исключение из чата: `getChatMember`; член (member/administrator/creator/restricted+is_member) → `banChatMember` + `unbanChatMember(only_if_banned=true)`; «уже нет» — только left/kicked/restricted без членства; «member not found», ошибки API, отсутствие Telegram ID — «не подтверждено». Увольнение не `complete`, пока по каждому чату нет итога «исключён»/«уже нет».
- Приглашение: `createChatInviteLink(member_limit=1, name=<имя сотрудника>)` по чатам должности; одно сообщение с inline-кнопками в чат приглашений; защита от повтора по ключу (сотрудник, событие).
- Quick Resto: только существующий клиент (`callQuickRestoBackOfficeData`, `withBackOfficeSession`, `getConnection`); идемпотентность — перечитывание состояния до и после шага (образец `src/lib/people/termination-remote.ts`).
- Тексты UI по-русски; `docs/design-system.md`; справка `docs/handbook/people/` обязательна.
- Проверки: `pnpm exec tsc --noEmit`, `pnpm lint`, `node --test --experimental-strip-types` по затронутым `*.test.mts`.

## Review Focus

1. Увольнение человека без Telegram ID — итог «не подтверждено», процесс в `error` с понятным текстом, а не `complete`. Тест в Task 2.
2. Повтор после частичного сбоя: уже исключённые чаты/уже списанные бонусы не повторяются вредно (бонусы: перечитать баланс перед списанием). Тесты в Task 2 и Task 3.
3. Возврат, когда запись Quick Resto стёрта окончательно — ошибка с текстом, без частичного «успеха». Тест в Task 5.
4. Смена должности с датой в прошлом в зафиксированном зарплатном периоде — отказ. Тест в Task 6.
5. Чужой аккаунт: все admin-запросы фильтруются по account_id. Проверка в ревью каждой задачи.

---

### Task 1: Таблицы чатов и журнала Telegram

**Files:** Create `supabase/migrations/313_staff_telegram_chats.sql`; types в `src/types/database.ts` (точечно); Test `supabase/tests/staff_telegram_chats.sql`.

**Interfaces — Produces:**
- `telegram_chats(id uuid pk, account_id, chat_id text, title text, invite boolean default true, role_ids uuid[] default '{}', archived_at, created_at, updated_at, unique(account_id,id), unique(account_id,chat_id))` — `role_ids` пусто = чат для всех должностей при `invite`.
- `staff_telegram_actions(id, account_id, user_id uuid, kind text check in ('invite','remove'), event_key text, chat_id text, result text check in ('invited','removed','absent','unconfirmed','error'), detail text, created_at)`; уникальный `(account_id, event_key, chat_id)` для идемпотентности.
- RLS: чтение/правка чатов — право управлять интеграциями (то же, что у настроек Telegram в `274_organization_telegram.sql`); журнал — чтение тем же правом, запись только service-role.

- [ ] Миграция + SQL-тест (уникальность, RLS-доступ для чужого аккаунта = 0 строк) → `pnpm db:reset` → commit.

### Task 2: Чистые решения Telegram

**Files:** Create `src/lib/integrations/telegram-membership.ts`, Test `src/lib/integrations/telegram-membership.test.mts`.

**Interfaces — Produces:**
```ts
export type MemberStatus = "member" | "absent" | "unknown";
export function classifyChatMember(apiResult: { ok: boolean; result?: { status?: string; is_member?: boolean }; description?: string }): MemberStatus;
export type ChatRow = { chat_id: string; title: string; invite: boolean; role_ids: string[]; archived_at: string | null };
export function chatsForRole(chats: ChatRow[], roleId: string | null): ChatRow[]; // invite && !archived && (role_ids пусто || содержит roleId)
export function removalComplete(results: Array<"removed" | "absent" | "unconfirmed" | "error">): boolean;
```
- [ ] Тесты: каждый статус Bot API (creator/administrator/member/restricted±is_member/left/kicked), `ok:false` и «member not found» → unknown; `chatsForRole` (пустые роли, архив, invite=false); `removalComplete` false при любом unconfirmed/error. → реализация → commit.

### Task 3: Клиент Telegram и шаг исключения при увольнении; списание бонусов

**Files:** Create `src/lib/integrations/telegram-bot.ts` (server-only: `getChatMember`, `banChatMember`, `unbanChatMember`, `createChatInviteLink`, `sendMessage(chatId, text, buttons?)`; токен из настроек организации). Modify `src/lib/people/termination-remote.ts` (списание остатка), `src/lib/people/termination.ts` (шаг Telegram + отчёт), `src/lib/people/termination-remote.test.mts`.

- Бонусы: в `removeStaffFromQuickResto` вместо ошибки «есть остаток» — если `available > 0` и `debitHold/creditHold == 0`: `accountDebit` на `available` (тело как в `src/lib/payroll/bonus-worker.ts` send), шаг `bonus_writeoff_<id>` в `done` с суммой; перечитать баланс; при ненулевых hold — прежняя ошибка. Новый метод транспорта `debitBonus(row, amount, query)`.
- Telegram: после Quick Resto — шаг `telegram`: для всех неархивных чатов организации классифицировать и исключить, писать `staff_telegram_actions` (event_key = `termination:<id>`), не повторять чаты с итогом removed/absent; если `!removalComplete` — бросить ошибку «Не подтверждено исключение из чатов: …» (процесс уйдёт в `error` и повторится по cron). По завершении — отчёт в чат отчётов (имя, итог по каждому чату, списанные бонусы).
- Telegram ID — `profiles.telegram_id` уволенного.
- [ ] Тесты termination-remote: остаток списывается один раз при повторе; hold ≠ 0 → ошибка. → реализация → tsc/lint/tests → commit.

### Task 4: Приглашения при приёме

**Files:** Modify `src/lib/candidates/jobs.ts` (+ kind в `candidate_jobs` через миграцию 313 или 314), место постановки задания после `candidate_finish_hire` (`src/lib/candidates/provision.ts`).

- После успешного приёма — задание `chat_invites` (payload: user_id, role_id, name). Обработчик: `chatsForRole` → `createChatInviteLink` по каждому → одно сообщение в чат приглашений с кнопками (текст как в n8n: имя, «отправьте по ссылке, лимит 2–3 чата в минуту»); журнал `kind='invite'`, event_key `hire:<hire_id>`; при 0 чатов — короткое сообщение «нет чатов для должности».
- [ ] tsc/lint/tests → commit.

### Task 5: Возврат сотрудника

**Files:** Migration (RPC `staff_begin_restore` + таблица/расширение журнала шагов по образцу `staff_terminations`, правка `private.staff_termination_guard`), Create `src/lib/people/restore.ts`, `src/lib/people/restore-remote.ts` (+ `.test.mts`), Modify `restoreStaff` в `src/app/(dashboard)/people/staff/actions.ts`, cron `src/app/api/cron/candidates/route.ts` (обрабатывать и возвраты).

- Шаги (каждый с перечитыванием): Quick Resto `personnel.employee/recover` прежнего сотрудника (id из `payroll_employees.quickresto_id`) → проверить, что не deleted; `crm.customer/recover` гостя → группа Staff (id из `candidate_employment_settings`/существующей конфигурации приёма); новый бонусный счёт (как в `provision.ts`); новый код двери (`candidate_reserve_door`-аналог для существующего сотрудника); `payroll_employees.active=true`, `user_venue_roles.status='active'`, `fired_at/fired_reason=null`; задание приглашений (Task 4, event_key `restore:<id>`).
- Если recover вернул ошибку «не найдено»/запись остаётся deleted — ошибка «Запись Quick Resto не восстанавливается: заведите сотрудника заново через приём», статус доступа не меняется.
- [ ] Тесты restore-remote (recover идемпотентен; стёртая запись → ошибка) → реализация → commit.

### Task 6: Смена должности в зарплате

**Files:** Modify `updateStaffRole` (`src/app/(dashboard)/people/staff/actions.ts`) → принимает `validFrom: string`; RPC в миграции (или существующая `assignPayrollPosition` в `src/app/(dashboard)/people/payroll/actions.ts` — переиспользовать, если делает то же); UI выбора даты в карточке сотрудника.

- Роль доступа + `payroll_employees.role_id/role_name/model_id` (модель — по умолчанию для должности, как при приёме) + `payroll_employee_models` с `valid_from`; дни с `validFrom` — в очередь пересчёта зарплаты; отказ, если месяц `validFrom` зафиксирован (`payroll_periods.status <> 'draft'`).
- [ ] tsc/lint → commit.

### Task 7: Настройки чатов и справка

**Files:** UI в `src/app/(dashboard)/settings/integrations/telegram/` — список чатов (название, ID, «приглашать при приёме», должности), добавить/изменить/архивировать; server actions с правом интеграций. Справка `docs/handbook/people/` (приём, увольнение, возврат, смена должности, чаты) и `docs/handbook/settings/`.

- [ ] tsc/lint → commit.

### Task 8: Перенос, приёмка (после мержа, с владельцем)

- Миграции на прод; перенос списка чатов из Notion «Чаты» (чекбокс «Приглашения», должности → роли Sheerly) — SQL по прочитанным данным; проверить, что бот администратор в каждом чате (getChatMember бота).
- Повтор трёх застрявших увольнений (cron/кнопка) — бонусы списаны, гости удалены, чаты.
- Отключение n8n-сценариев — только по команде владельца.
