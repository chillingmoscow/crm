# Бэклог проекта CRM

> Документ для отслеживания состояния проекта. Обновляется по мере выполнения задач.

---

## ✅ Сделано

### Инфраструктура
- Next.js 15 (App Router) + TypeScript + pnpm
- Tailwind CSS + shadcn/ui (button, card, input, label, select, separator, switch, checkbox, badge, sidebar, sheet)
- Supabase: локальное окружение через Supabase CLI + Docker
- Supabase: production окружение на сервере (`supabase.sheerly.app`)
- Production деплой через Coolify + GitHub webhook (автодеплой из `main`)
- DNS/SSL для `sheerly.app` и `supabase.sheerly.app`
- `@supabase/ssr` v0.8.x + `@supabase/supabase-js` v2
- Middleware: обновление сессии, защита роутов, обход зацикливания при невалидном токене
- TypeScript типы БД в `src/types/database.ts`
- Удалён демо-роут `/invite/layout-demo` и связанные seed/snippet файлы

### База данных (миграции 001–028)

| Файл | Содержимое |
|---|---|
| `001` | accounts, venues, profiles, roles, permissions, role_permissions, user_venue_roles, invitations |
| `002` | Системные роли: owner, manager, admin, staff, waiter, hostess + матрица прав |
| `003` | RLS для всех таблиц |
| `004` | Триггер создания профиля при регистрации; функции `get_active_venue_id`, `has_permission` |
| `005` | Storage buckets: avatars, venue-logos, account-logos |
| `006` | RLS для управления ролями; `get_active_account_id()` |
| `007` | Политика удаления заведений |
| `008` | Исправление рекурсии RLS через security definer |
| `009` | Управление сотрудниками: `get_venue_staff()`, `get_user_venues()`, `accept_invitation()` |
| `010` | Исправление политик venues/invitations |
| `011` | Расширенный профиль: phone, telegram_id, gender, birth_date, address, employment_date, avatar_url, medical_book_number/date, passport_photos; бакет staff-documents |
| `012` | Мягкое увольнение: `status`/`fired_at` в user_venue_roles; `get_fired_staff()` |
| `013` | Таблица уведомлений с RLS; триггер auto-fill employment_date; расширение `get_venue_staff` (phone, telegram, gender, birth_date) |
| `014` | Доступ к профилям сотрудников в рамках активного заведения |
| `015` | Демо-структуры залов |
| `016` | Усиление security/RLS для staff-операций |
| `017` | Права системных ролей в матрице role_permissions |
| `018` | Комментарии в сущностях персонала/заведений |
| `019` | Production-структуры для залов |
| `020` | Hardening активного membership (`active_venue_id`, `has_permission`, `get_active_account_id`) |
| `021` | Ужесточение `public` grants |
| `022` | Account-scoped права для системных ролей |
| `023` | Backward compatibility для матрицы role permissions |
| `024` | Дополнительные поля профиля (`gender`, `birth_date`, `telegram_id`, `address`) |
| `025` | Исправление каскадов удаления пользователя (`accounts.owner_id`, `invitations.invited_by`) |
| `026` | Новые типы `venue_type`, поле `venues.website`, обновлён `complete_owner_onboarding()` |
| `027` | Обновлён constraint `profiles.gender` |
| `028` | Исправление `get_user_venues()` (UNION + `status = 'active'`) + `complete_owner_onboarding()` явный `status = 'active'` |

### Аутентификация

- Исправлен `{}` в error banner на странице регистрации (`setGlobalError(error.message)` вместо объекта)
- Исправлен overlap иконки браузерного автозаполнения (Bitwarden и др.) — `z-10` на иконку + `ring-2 ring-blue-100` на фокус (login + register)
- Убран `router.refresh()` после `router.push()` на регистрации — устранена заметная задержка после "Продолжить"
- Email/пароль, восстановление пароля
- OAuth callback + приём приглашений (`/invite`)
- `Invite`-flow защищён middleware (роут больше не публичный для неавторизованных)
- Полный редизайн всех auth-страниц в стиле Sheerly:
  - `/login` — двухколоночный layout (PromoPanel + форма), FloatingField с плавающим лейблом
  - `/register` — тот же layout, поля: имя, email, пароль, подтверждение пароля
  - `/forgot-password` — двухколоночный layout, форма запроса сброса
  - `/reset-password` — центрированный layout, поля нового пароля с eye-toggle
  - `/verify-email` — центрированный layout с инструкцией (отдельная страница после регистрации)
  - `/auth/email-confirmed` — центрированный layout с подтверждением
- Локализация типовых ошибок входа (в т.ч. "Почта не подтверждена")
- Исправлены redirect/callback сценарии (без `localhost`/SSL ошибок в production)
- Исправлен конфликт padding с иконками автозаполнения браузера (Bitwarden и др.): условный `pr-4`/`pr-10` в зависимости от наличия `rightSlot`

### Email-шаблоны

- `src/lib/invitations/mailer.ts` — полный редизайн `buildInvitationHtml()`: логотип Sheerly (синий квадрат "S" + wordmark), иконка 👋, блок с деталями заведения/роли/пригласившего, синяя CTA-кнопка, fallback-ссылка, footer
- `public/email-templates/confirm-signup.html` — шаблон подтверждения email в стиле Sheerly для GoTrue (`{{ .ConfirmationURL }}`)
- `public/email-templates/reset-password.html` — шаблон сброса пароля + amber-блок предупреждения безопасности
- Настройка в Coolify: переменные `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`, `GOTRUE_MAILER_TEMPLATES_RECOVERY` → URL шаблонов из `public/email-templates/`

### Онбординг (`/onboarding`)
Wizard из 5 шагов: профиль → аккаунт → заведение → персонал → готово
- Исправлены стили полей в `step-profile` — соответствуют login/register (`ring-2` на focus/error)
- Переименован лейбл "ID Telegram" → "Telegram ID"; тултип переведён на JS-таймер, скрывается через 5 с
- Wizard сохраняет данные шага 1 (`savedProfile` state) при возврате с шага 2
- `step-profile` использует `uploadAvatar` (бакет `avatars/`) вместо `uploadLogo` — аватары и логотипы в разных папках
- Синхронизация аватара в `profiles.avatar_url` и `profiles.photo_url` для обратной совместимости
- Приглашение по email: ссылка ведёт на домен приложения (`/auth/confirm?token_hash=...`), а не на Supabase
- Добавлены `/auth/confirm` route handler и `/set-password` страница для invited-users flow
- Миграция `028`: исправлен `get_user_venues()` (UNION + `status = 'active'`), venue switcher появляется сразу после онбординга; `complete_owner_onboarding()` явно выставляет `status = 'active'`

### UI Shell
- Collapsible sidebar (shadcn Sidebar): схлопывается в иконки на desktop, drawer на mobile
- Фильтрация пунктов меню по роли активного заведения (owner видит всё, waiter — ничего)
- Переключатель заведений (VenueSwitcher) с закрытием по клику снаружи
- Notification bell в шапке: панель с фильтром "Все / Непрочитанные", mark-as-read, mark-all-read

### Настройки → Должности (`/settings/roles`)
- Список ролей (системные + кастомные)
- Матрица прав с оптимистичными обновлениями
- Создание и удаление кастомных должностей

### Настройки → Заведения (`/settings/venues`)
- Просмотр и редактирование заведений аккаунта

### Настройки → Профиль (`/settings/profile`)
- Редактирование личных данных

### Сотрудники (`/staff`)
- Таблица активных сотрудников + ожидающие приглашения
- Настройка видимости столбцов (иконка): Фото, Email, Телефон, Telegram, Пол, Дата рождения, Должность, Трудоустройство
- Поиск по имени/email (раскрывается по нажатию на лупу)
- Фильтры: по должности, по полу
- Карточка сотрудника (Sheet): контакты, личные данные, документы (паспорт, медкнижка), загрузка аватара
- Дата трудоустройства = обязательное поле, автоматически заполняется при добавлении
- Мягкое увольнение: статус "уволен", раздел "Уволенные сотрудники" с кнопкой "Восстановить"
- Приглашение по email с выбором должности
- Инвайты для существующих пользователей (без ошибки `already been registered`)
- Мгновенное отображение pending-приглашения в таблице без ручной перезагрузки
- Batch upsert приглашений при принятии (`/invite`) вместо последовательных запросов
- Кастомные invitation письма через Resend API (с fallback на шаблонные письма Supabase)
- Стабилизация мульти-тенантного потока: автоматическая синхронизация `pending` инвайтов при входе
- Ролевой доступ: owner/manager/admin могут редактировать, остальные — только просмотр

---

## 🔜 Ближайшее

- [ ] **Уведомления** — механизм создания: при принятии приглашения, увольнении, истечении медкнижки
- [ ] **Real-time** обновления в таблице сотрудников и уведомлениях (Supabase Realtime)
- [ ] **Поиск по паспорту/медкнижке** — отдельный режим поиска по документам

---

## 📋 Запланировано

### Персонал
- [ ] История изменений должности сотрудника
- [ ] Повторная отправка приглашения
- [ ] Экспорт списка сотрудников (CSV / Excel)
- [ ] Групповые действия (mass fire, mass role change)

### Заведения
- [ ] Загрузка/смена логотипа заведения
- [ ] Управление часами работы через UI

### Аккаунт
- [ ] Настройки аккаунта (название, логотип)
- [ ] Управление подпиской / тарифом

### Общее
- [ ] Переключатель темы (светлая/тёмная)
- [ ] Мультиязычность (RU / EN)

---

## Технические решения

| Решение | Обоснование |
|---|---|
| `pnpm` вместо `npm` | Быстрее, экономит место через hardlinks |
| Turbopack (`--turbopack`) | ~10x быстрее HMR в dev-режиме |
| Supabase local (`supabase start`) | Полный локальный стек без интернета |
| RLS на уровне БД | Безопасность данных независимо от кода |
| Server Actions | Нет отдельного API-слоя, данные прямо в Server Components |
| Soft-delete (status fired) | Сотрудники не удаляются, история сохраняется |
| Актуализированные Supabase TS-типы | Убраны `any`/касты в server actions и страницах, снижён риск runtime-ошибок |
| Динамический grid-template | Видимость столбцов без сдвигов через `style={{ gridTemplateColumns }}` |
| FloatingField — условный `pr-4`/`pr-10` | Email-поля без rightSlot не получают лишний отступ, иконки браузера не перекрывают текст |
| Email-шаблоны в `public/email-templates/` | Файлы отдаются Next.js статически; GoTrue подхватывает по URL через `GOTRUE_MAILER_TEMPLATES_*` |
