# Контрагенты, этап 2: поставщики, условия поставок, контакты, «Закупаем» — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Отметка «Поставщик» (руками и сама при привязке к позиции номенклатуры), фильтр поставщиков в списке, необязательные условия поставок, несколько контактов с Telegram, вкладка «Закупаем» в карточке контрагента.

**Architecture:** Всё новое — колонки `counterparties`, правится в той же форме «Данные» и сохраняется общей полосой через `updateCounterparty`. Контакты — `jsonb`-массив `counterparties.contacts` (решение исполнителя, см. ниже), старые `contact_person/phone/email` остаются в базе без записи (сужение — позже). Журнал — существующий триггер `counterparties_audit_trigger` дополняется новыми полями. Отметка ставится триггером на `ingredient_suppliers`.

**Spec:** `docs/superpowers/specs/2026-11-24-counterparties-suppliers-design.md`, разделы 3–5.

## Решение исполнителя (отличие от дизайна)

Дизайн предлагал таблицу `counterparty_contacts`. Делаем `jsonb`-колонку: контакты не живут отдельно от контрагента, правятся в его форме и сохраняются одной кнопкой (атомарно, одной строкой), журнал видит изменение тем же триггером, не нужны отдельные RLS, тенантность и действия. Цена: нельзя искать по телефону контакта запросом — сейчас не нужно.

## Global Constraints

- Миграция `387_counterparty_suppliers_contacts.sql` (проверить свободный номер на `origin/main` перед коммитом).
- `create or replace function` — с `set search_path = public, pg_catalog`; тело триггера журнала брать из базы (`pg_get_functiondef`), а не по памяти.
- Тексты `raise exception` и интерфейса — по-русски; дизайн — по `docs/design-system.md`.
- Все поля условий и контактов необязательные. Блок «Условия поставок» виден только при включённой отметке «Поставщик»; выключение отметки не стирает условия.
- Telegram хранится ником без `@` (`[A-Za-z0-9_]{5,32}`); ввод принимает `@ник`, `t.me/ник`, `https://t.me/ник`.
- Не более 10 контактов; имя обязательно у непустого контакта.
- Справка `docs/handbook/finance/counterparties.md` и `docs/handbook/` каталога (карточка позиции показывает контакт поставщика) обновляются.

## Review Focus

1. Контрагента привязали поставщиком к позиции, у него была снята отметка — отметка встаёт, журнал пишет изменение.
2. Контакт только с Telegram «@Ivan_Petrov» или ссылкой — сохраняется ник `Ivan_Petrov`, в карточке ссылка `https://t.me/Ivan_Petrov`.
3. Старый контрагент с заполненными контактным лицом/телефоном — после миграции его контакт виден в карточке, в списке и в карточке позиции каталога.
4. Пользователь без `inventory.view_products` открывает карточку — вкладки «Закупаем» нет, ошибок нет.
5. Отметку «Поставщик» сняли — условия поставок скрыты, но не потеряны; включили снова — на месте.

---

### Task 1: Чистые помощники контактов и условий

**Files:** Create `src/lib/finance/counterparty-contacts.ts`, test `src/lib/finance/counterparty-contacts.test.mts`.

**Produces:**
- `type CounterpartyContact = { name: string; role: string | null; phone: string | null; email: string | null; telegram: string | null }`
- `normalizeTelegram(input: string): { value: string | null; error: string | null }` — `""`→`{null,null}`; `@ник`/`t.me/ник`/`https://t.me/ник`→ник; иначе ошибка «Telegram: ник из 5–32 латинских букв, цифр и _».
- `telegramUrl(nick: string): string` → `https://t.me/<nick>`.
- `normalizeContacts(input: unknown): { contacts: CounterpartyContact[]; error: string | null }` — убирает полностью пустые, тримит, валидирует почту (как `validate` в counterparties.ts), Telegram, обязательное имя («Укажите имя контакта»), максимум 10 («Не больше 10 контактов»).
- `WEEKDAYS: { value: number; short: string }[]` (1=пн … 7=вс) и `normalizeWeekdays(input: unknown): number[]` (уникальные 1–7 по возрастанию).

- [ ] Тесты: Telegram (`@Ivan_Petrov`, `t.me/ivan_p`, `https://t.me/ivan_p`, `иван`→ошибка, `abc`→ошибка), контакты (пустой отбрасывается, без имени → ошибка, плохая почта → «Проверьте адрес почты», 11 → ошибка), дни (`[3,1,3,9]`→`[1,3]`). RED → реализация → GREEN → commit.

### Task 2: Миграция 387

**Files:** Create `supabase/migrations/387_counterparty_suppliers_contacts.sql`; Modify `src/types/database.ts` (counterparties Row/Insert/Update — руками, новые поля).

- `alter table counterparties add column is_supplier boolean not null default false, payment_delay_days integer check (between 0 and 365), order_weekdays smallint[] not null default '{}', delivery_weekdays smallint[] not null default '{}', min_order_amount numeric(14,2) check (>= 0), contacts jsonb not null default '[]'` + check `jsonb_typeof(contacts) = 'array'`; check дней недели `<@ array[1..7]`.
- Заполнение: `is_supplier = true` всем из `ingredient_suppliers`; `contacts` = `[{name, phone, email}]` из старых колонок, где хоть одна заполнена (имя — `contact_person`, иначе «Контакт»).
- Триггер `ingredient_suppliers_mark_supplier` (after insert, SECURITY DEFINER, search_path): `update counterparties set is_supplier = true where account_id = NEW.account_id and id = NEW.counterparty_id and not is_supplier`.
- `counterparties_audit_trigger`: полное тело из базы + изменения по `is_supplier`, `payment_delay_days`, `min_order_amount`, `order_weekdays`/`delivery_weekdays` (старое/новое — строкой «пн, ср» через помощник `public.weekday_names(smallint[])`), `contacts` (строкой имён через запятую).
- Индекс `counterparties (account_id) where is_supplier and deleted_at is null` не нужен (списки целиком) — не делать.
- [ ] Применить локально в `begin … rollback`, затем по-настоящему; проверить: заполнение, триггер (вставка в `ingredient_suppliers` ставит отметку), журнал пишет `is_supplier`. Commit.

### Task 3: Сервер и форма «Данные»

**Files:** Modify `src/types/finance.ts` (`CounterpartyFormInput` + `is_supplier?`, `payment_delay_days?`, `order_weekdays?`, `delivery_weekdays?`, `min_order_amount?`, `contacts?`; убрать `contact_person/phone/email` из ввода), `src/lib/finance/counterparties.ts` (`normalize`/`validate` — новые поля через помощники Task 1; `createCounterparty` пишет `contacts`), `counterparty-requisites.tsx`, `src/components/finance/counterparty-create-drawer.tsx`, `src/lib/audit/labels.ts` (подписи полей: «поставщик», «отсрочка платежа, дней», «дни заказа», «дни доставки», «минимальный заказ», «контакты»).

- Форма «Данные»: блок «Контакты» — список карточек контакта (имя*, роль, телефон `PhoneInput`, почта, Telegram) с «Добавить контакт» и удалением; в режиме чтения — строки со ссылками `tel:`, `mailto:`, Telegram. Блок «Учёт»: переключатель «Поставщик». Блок «Условия поставок» (только при отметке): отсрочка (число дней), минимальный заказ (`AmountInput`), дни заказа и дни доставки (переключатели пн…вс).
- Панель создания: вместо трёх полей контакта — один контакт (имя, телефон, почта, Telegram) и переключатель «Поставщик».
- Ошибка проверки контакта показывается у блока «Контакты».
- [ ] tsc + lint, проверка в браузере (создать контакт с Telegram, сохранить, журнал; включить/выключить «Поставщик», условия сохраняются). Commit.

### Task 4: Список и каталог читают новые поля

**Files:** `src/app/(dashboard)/finance/counterparties/page.tsx`, `_components/counterparties-client.tsx`, `src/lib/inventory/ingredients.ts` (контакт поставщика — первый из `contacts`).

- Список: строка `CounterpartyListRow` получает `isSupplier`, контакт — первый из `contacts`; фильтр «Тип»: «Все / Поставщики / Остальные» (`TableFilterChip`, как «Группа»); у поставщика в подписи под названием — «Поставщик».
- [ ] tsc + lint + браузер. Commit.

### Task 5: Вкладка «Закупаем»

**Files:** Create `src/app/(dashboard)/finance/counterparties/[id]/_components/counterparty-purchases.tsx`; Modify `page.tsx` (загрузка), `counterparty-card.tsx` (вкладка).

- Данные: `ingredient_suppliers` контрагента + `ingredients(id, name, kind, archived_at)`, только если есть `inventory.view_products`. Строка: название (ссылка `/catalog/{ingredients|semi-products|dishes}/<id>` по `kind`; модификаторы — без ссылки), вид, артикул, цена (`Money`), «Основной». Пусто — «Позиции номенклатуры к этому поставщику не привязаны. Поставщика добавляют в карточке позиции, вкладка «Поставщики»».
- Вкладка видна, если есть право и (есть позиции или `is_supplier`).
- [ ] tsc + lint + браузер (привязать контрагента к ингредиенту в каталоге → вкладка показывает позицию, отметка «Поставщик» встала). Commit.

### Task 6: Справка и проверка

- [ ] `docs/handbook/finance/counterparties.md`: поставщик, условия, контакты, «Закупаем», фильтр. Каталог — без изменений текста, если там не описаны поля контакта.
- [ ] `pnpm exec tsc --noEmit && pnpm lint && node --test --experimental-strip-types "src/lib/finance/*.test.mts" "src/lib/files/*.test.mts"`. Commit.
