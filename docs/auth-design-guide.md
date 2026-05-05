# Sheerly — Design Guide: Auth & Onboarding

> Документ описывает дизайн-систему страниц авторизации и онбординга на основе анализа
> существующего кода. Использовать как эталон при добавлении новых экранов.

---

## 1. Страницы и их layout

### 1.1 Split-layout (авторизационные формы)

Используется на: `/login`, `/register`, `/forgot-password`

```
┌─────────────────────┬──────────────────────┐
│   PromoPanel        │   Form panel         │
│   (bg-blue-600)     │   (bg-white)         │
│   52–55% ширины     │   flex-1             │
│   только lg+        │   всегда видна       │
└─────────────────────┴──────────────────────┘
```

```tsx
<div className="fixed inset-0 z-50 flex overflow-hidden bg-white">
  <PromoPanel />  {/* hidden lg:flex lg:w-[52%] xl:w-[55%] */}
  <div className="flex-1 overflow-y-auto">
    <div className="min-h-full flex flex-col items-center justify-center px-6 sm:px-10 py-10">
      {/* Mobile logo — lg:hidden */}
      {/* Form content — max-w-[440px] */}
    </div>
  </div>
</div>
```

**PromoPanel** содержит:
- Логотип `h-8 brightness-0 invert` (белый на синем)
- Мокап продукта по центру
- Слайдовый текст с dot-навигацией внизу
- Цвет фона: `bg-blue-600`

### 1.2 Centered-layout (информационные состояния)

Используется на: `/verify-email`, `/email-confirmed`, `/reset-password`, `/set-password`

```
┌────────────────────────────────────────────┐
│  (bg-white, fixed inset-0)                 │
│                                            │
│          Logo (h-8, mb-12)                 │
│          Icon circle (w-16 h-16)           │
│          Heading                           │
│          Subtext                           │
│          CTA button                        │
│                                            │
└────────────────────────────────────────────┘
```

```tsx
<div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
  <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
  {/* ... content ... */}
</div>
```

---

## 2. Цветовая палитра

| Роль | Значение | Tailwind | Использование |
|------|----------|----------|---------------|
| Primary / Accent | `#2563eb` | `blue-600` | Кнопки, фокус, ссылки, иконки в icon-circle |
| Primary hover | `#1d4ed8` | `blue-700` | Кнопки при hover |
| Focus ring | `#dbeafe` | `blue-100` | `ring-2 ring-blue-100` |
| PromoPanel bg | `#2563eb` | `blue-600` | Фон левой панели |
| Promo text muted | `#bfdbfe` | `blue-200` | Подтекст слайдов на синем фоне |
| Promo dot active | `#ffffff` | `white` | Активная точка навигации слайдов |
| Promo dot inactive | `#93c5fd` | `blue-400` | Неактивная точка |
| Body text | `#111827` | `gray-900` | Заголовки, значения полей |
| Secondary text | `#6b7280` | `gray-500` | Подзаголовки, описания |
| Muted text | `#9ca3af` | `gray-400` | Placeholder, вспомогательный текст |
| Border default | `#e5e7eb` | `gray-200` | Границы полей, компонентов |
| Border hover | `#d1d5db` | `gray-300` | Границы при hover |
| Background forms | `#ffffff` | `white` | Фон полей, карточек |
| Icon bg (blue) | `#eff6ff` | `blue-50` | Icon-circle для нейтральных состояний |
| Error text | `#dc2626` | `red-600` | Текст ошибок в баннере |
| Error bg | `#fef2f2` | `red-50` | Фон баннера ошибки |
| Error border | `#fecaca` | `red-200` | Граница баннера ошибки |
| Error field border | `#f87171` | `red-400` | Граница поля с ошибкой |
| Error field msg | `#ef4444` | `red-500` | Текст ошибки под полем |
| Success icon bg | `#dcfce7` | `green-100` | Icon-circle успешного состояния |
| Success icon | `#16a34a` | `green-600` | Иконка Check |

---

## 3. Типографика

| Элемент | CSS | Tailwind |
|---------|-----|---------|
| Заголовок страницы | `font-size: 32px; line-height: 40px; font-weight: 600` | `text-[32px] leading-[40px] font-semibold text-gray-900` |
| Заголовок страницы (error-state) | `font-size: 28px; line-height: 36px; font-weight: 600` | `text-[28px] leading-[36px] font-semibold text-gray-900` |
| Подзаголовок / описание | `font-size: 16px; line-height: 24px` | `text-[16px] leading-[24px] text-gray-500` |
| Promo headline | `font-size: 22px; font-weight: 700` | `text-[22px] font-bold` |
| Секция (группа полей) | uppercase, letter-spacing | `text-xs font-semibold text-gray-400 uppercase tracking-wider` |
| Label поля (onboarding) | `font-size: 14px; font-weight: 500` | `text-sm font-medium text-gray-700` |
| Label floating (поднятый) | `font-size: 11px; font-weight: 500` | `text-[11px] font-medium` |
| Label floating (в поле) | `font-size: 14px` | `text-sm text-gray-400` |
| Значение в поле | `font-size: 14px` | `text-sm text-gray-900` |
| Ошибка под полем | `font-size: 12px` | `text-xs text-red-500` |
| Ссылки | `font-size: 14px` | `text-sm text-blue-600 hover:underline` |
| Вспомогательный текст (hint) | `font-size: 12px` | `text-xs text-gray-400` |
| Вспомогательный текст (кнопка) | `font-size: 14px` | `text-sm text-gray-500` |
| Шаг онбординга (badge) | `font-size: 12px; font-weight: 500` | `text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full` |
| Заголовок шага онбординга | `font-size: 24px; font-weight: 600` | `text-2xl font-semibold text-gray-900` |

---

## 4. Поля ввода (FloatingField)

**FloatingField — единственный стандарт** для всех текстовых полей ввода на страницах авторизации и онбординга.

Shared компонент: `@/components/ui/floating-field.tsx`

**Структура:**
```
┌─────────────────────────────────────┐  ← border + rounded-xl + h-12
│ 🔑  [Floating label]          [?]   │
│     input value                     │
└─────────────────────────────────────┘
   ↓ (ошибка)
   Текст ошибки — text-xs text-red-500 pl-1
```

**Состояния обёртки:**

| Состояние | Классы |
|-----------|--------|
| Default | `border-gray-200 hover:border-gray-300` |
| Focused | `border-blue-500 ring-2 ring-blue-100` |
| Error | `border-red-400` |

**Floating label:**
```tsx
// Поднятый (floated = true):
"top-0 -translate-y-1/2 left-3.5 text-[11px] font-medium px-1 bg-white z-10"
+ (focused ? "text-blue-500" : "text-gray-400")

// В поле (floated = false):
"top-1/2 -translate-y-1/2 left-10 text-sm text-gray-400"
```

**Иконка слева:**
```tsx
<span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10">
  {icon}  // w-4 h-4
</span>
```

**Input:**
```tsx
className={`absolute inset-0 w-full h-full bg-transparent pl-10 ${rightSlot ? "pr-10" : "pr-4"} text-sm text-gray-900 outline-none rounded-xl`}
```

**Интерфейс компонента:**
```tsx
type FloatingFieldProps = {
  id:            string;
  label:         string;
  placeholder?:  string;
  icon:          React.ReactNode;
  type?:         string;
  inputMode?:    React.HTMLAttributes<HTMLInputElement>["inputMode"];
  error?:        string;
  // Режим RHF (react-hook-form):
  registration?: UseFormRegisterReturn;
  // Режим controlled (локальный useState):
  value?:        string;
  onChange?:     React.ChangeEventHandler<HTMLInputElement>;
  // Опциональные:
  rightSlot?:    React.ReactNode;
  autoComplete?: string;
};
```

Если передан `value` — компонент работает в **controlled-режиме** (плавающий лейбл определяется из `value`).
Если передан `registration` — компонент работает в **RHF-режиме** (плавающий лейбл через внутренний `hasValue`).

**Используемые иконки (Lucide):**
| Поле | Иконка |
|------|--------|
| Email | `<Mail className="w-4 h-4" />` |
| Пароль / API-ключ | `<KeyRound className="w-4 h-4" />` |
| Имя / Фамилия / API-логин | `<User className="w-4 h-4" />` |
| Телефон | `<Phone className="w-4 h-4" />` |
| Telegram ID | `<Hash className="w-4 h-4" />` |
| Адрес | `<MapPin className="w-4 h-4" />` |
| Название аккаунта | `<Building2 className="w-4 h-4" />` |
| Название заведения | `<Store className="w-4 h-4" />` |
| Веб-сайт | `<Globe className="w-4 h-4" />` |
| Show/hide пароля | `<Eye />` / `<EyeOff />` (rightSlot, w-4 h-4, text-gray-400 hover:text-gray-600) |
| Подсказка (tooltip) | `<HelpCircle />` (rightSlot, w-4 h-4, text-gray-400 hover:text-gray-600) |

**Обнаружение автозаполнения:**
- Chrome: `onAnimationStart` с CSS-анимацией `autoFillStart` в `globals.css`
- Автозаполнение: `box-shadow: 0 0 0 1000px white inset` убирает синий фон браузера

**Использование (RHF-режим):**
```tsx
<FloatingField
  id="email"
  label="Email"
  placeholder="ivan@example.com"
  icon={<Mail className="w-4 h-4" />}
  type="email"
  registration={register("email")}
  error={errors.email?.message}
  autoComplete="email"
/>
```

**Использование (controlled-режим — без RHF):**
```tsx
const [password, setPassword] = useState("");

<FloatingField
  id="qr-password"
  label="Пароль для API"
  placeholder="••••••••"
  type="password"
  icon={<KeyRound className="w-4 h-4" />}
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  autoComplete="current-password"
/>
```

---

### 4.2 Select (выпадающий список)

```tsx
function selectTriggerCls(hasError: boolean) {
  return [
    "h-12 rounded-xl text-sm bg-white transition-colors duration-150",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-100"
      : "border-gray-200 hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
  ].join(" ");
}

// SelectContent:
"max-h-60 rounded-xl border-gray-100 shadow-lg"
```

---

## 5. Кнопки

### 5.1 Primary CTA (форма)

Умная кнопка: меняет стиль в зависимости от готовности формы (без `disabled`, стиль через className).

```tsx
// Форма заполнена корректно:
"bg-blue-600 hover:bg-blue-700 text-white"

// Форма не заполнена:
"bg-[#F9FAFB] text-gray-400 border border-gray-200 hover:bg-[#F3F4F6]"

// Общие классы:
"w-full h-[50px] text-base font-medium rounded-xl transition-colors duration-200"
```

С Loader при отправке:
```tsx
{loading && <Loader2 className="animate-spin mr-2 w-4 h-4" />}
```

### 5.2 Primary CTA (информационные страницы)

Кнопка-ссылка для перехода (не зависит от формы):
```tsx
"h-[50px] px-10 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-xl transition-colors duration-200"
```

### 5.3 Secondary (onboarding)

```tsx
"h-9 px-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors duration-150"
```

### 5.4 Кнопка Далее (onboarding-wizard)

```tsx
"h-12 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors duration-150 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
```

### 5.5 Gender toggle (onboarding)

Кнопки-переключатели пола:
```tsx
// Активна:
"bg-blue-50 border-blue-500 text-blue-700"
// Не активна:
"border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
// Общие:
"flex-1 h-11 rounded-xl border text-sm transition-colors duration-150 font-medium"
```

---

## 6. Чекбоксы

```tsx
<Checkbox className="rounded-md border-gray-200 hover:border-gray-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
```

Скруглённые углы (`rounded-md`), при выборе — синий фон/граница `blue-600`.

---

## 7. Баннер ошибки

```tsx
<div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-5 text-sm">
  <AlertCircle className="w-4 h-4 shrink-0" />
  <span>{globalError}</span>
</div>
```

---

## 8. Icon-circle (информационные состояния)

Круглый контейнер для центральной иконки на centered-экранах:

| Смысл | Фон | Иконка | Классы иконки |
|-------|-----|--------|--------------|
| Нейтральный (email, пароль) | `bg-blue-50` | тематическая | `w-8 h-8 text-blue-600` |
| Успех | `bg-green-100` | `<Check strokeWidth={2.5}>` | `w-8 h-8 text-green-600` |
| Ошибка | `bg-red-100` | `<AlertCircle>` | `w-8 h-8 text-red-600` |

```tsx
<div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-6">
  <MailCheck className="w-8 h-8 text-blue-600" />
</div>
```

---

## 9. Индикатор надёжности пароля

Показывается под полем пароля при вводе, скрывается если есть ошибка валидации.

```
┌──────────────────────────────────┐  ← h-1 bg-gray-200 rounded-full
│████░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← цветная полоска (25/50/75/100%)
└──────────────────────────────────┘
Хороший пароль                       ← text-xs (цвет соответствует уровню)
```

| Уровень | Цвет полоски | Цвет текста | Ширина |
|---------|-------------|------------|--------|
| 1 – Слабый | `bg-red-400` | `text-red-500` | 25% |
| 2 – Средний | `bg-yellow-400` | `text-yellow-600` | 50% |
| 3 – Хороший | `bg-blue-400` | `text-blue-500` | 75% |
| 4 – Надёжный | `bg-green-500` | `text-green-600` | 100% |

Анимация: `transition-all duration-300`

---

## 10. Состояния загрузки

**Полный экран (checking session, token verify):**
```tsx
<div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6">
  <img src="/logo-full.svg" alt="Sheerly" className="h-8 mb-12" />
  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
</div>
```

**Внутри кнопки:**
```tsx
<Loader2 className="animate-spin mr-2 w-4 h-4" />
```

---

## 11. Ссылки-навигации

**Ссылки между страницами (под формой):**
```tsx
// Контейнер:
<p className="text-center text-sm text-gray-500 mt-6">
  Нет аккаунта?{" "}
  <Link href="/register" className="text-blue-600 hover:underline font-medium">
    Зарегистрироваться
  </Link>
</p>
```

**Ссылка "Забыли пароль":**
```tsx
<Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
  Забыли пароль?
</Link>
```

**Кнопка "Назад" (ArrowLeft):**
```tsx
<Link href="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors duration-150">
  <ArrowLeft className="w-4 h-4" />
  Вернуться ко входу в систему
</Link>
```

---

## 12. Карточка онбординга

```tsx
// Обёртка шага:
<div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
  {/* Заголовок шага */}
  <div className="px-8 pt-8 pb-6 border-b border-gray-100">
    {/* Иконка шага */}
    <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
      <UserRound className="w-6 h-6 text-blue-600" />
    </div>
    {/* Badge */}
    <span className="text-xs font-medium text-gray-400 bg-gray-50 px-3 py-1 rounded-full">
      Шаг 1 / 3
    </span>
    <h1 className="text-2xl font-semibold text-gray-900 mb-1">Ваш профиль</h1>
    <p className="text-sm text-gray-500">Расскажите немного о себе</p>
  </div>
  {/* Тело формы */}
  <div className="px-8 py-6 space-y-6">
    {/* Группы полей */}
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Личные данные</p>
    {/* ... поля ... */}
  </div>
  {/* Footer с кнопкой */}
  <div className="px-8 pb-8">
    <button ...>Далее</button>
  </div>
</div>
```

**Иконки шагов (w-12 h-12 rounded-2xl bg-blue-50):**

| Шаг | Компонент | Иконка |
|-----|-----------|--------|
| Профиль | `step-profile.tsx` | `<UserRound className="w-6 h-6 text-blue-600" />` |
| Аккаунт | `step-account.tsx` | `<Building2 className="w-6 h-6 text-blue-600" />` |
| Заведение | `step-venue.tsx` | `<MapPin className="w-6 h-6 text-blue-600" />` |
| Сотрудники | `step-staff.tsx` | `<Users className="w-6 h-6 text-blue-600" />` |
| Режим импорта | `step-import-mode.tsx` | `<Zap className="w-6 h-6 text-blue-600" />` |
| QR: учётные данные | `step-quickresto-credentials.tsx` | `<PlugZap className="w-6 h-6 text-blue-600" />` |
| QR: параметры импорта | `step-quickresto-options.tsx` | тематическая |
| QR: импорт | `step-quickresto-import.tsx` | тематическая |

---

## 13. Tooltip (всплывающая подсказка)

```tsx
// Обёртка:
<div className="relative inline-flex" onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
  <HelpCircle className="w-4 h-4 text-gray-400 cursor-pointer hover:text-gray-600 transition-colors" />
  {tooltipVisible && (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                    w-64 rounded-xl bg-gray-900 px-3 py-2.5 text-xs text-white shadow-lg z-10">
      Текст подсказки...
      {/* Стрелка вниз: */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px
                      border-4 border-transparent border-t-gray-900" />
    </div>
  )}
</div>
```

---

## 14. Логотип

| Контекст | Класс |
|---------|-------|
| На белом фоне | `h-8` (оригинальные цвета) |
| На синем фоне (PromoPanel) | `h-8 brightness-0 invert` (белый) |
| Центрированный (verify/reset) | `h-8 mx-auto mb-10` или `h-8 mb-12` |
| Мобильный в split-layout | `lg:hidden mb-6` |

---

## 15. Анимации и переходы

| Элемент | Transition |
|---------|-----------|
| Границы полей | `transition-colors duration-150` |
| Плавающий label | `transition-all duration-150` |
| Кнопки | `transition-colors duration-200` |
| Полоска силы пароля | `transition-all duration-300` |
| Dot-навигация PromoPanel | `transition-all duration-300` |

---

## 16. Globals.css — специфика

```css
/* Убираем синий/жёлтый фон автозаполнения браузера */
input:-webkit-autofill {
  animation-name: autoFillStart;
  animation-duration: 1ms;
  -webkit-box-shadow: 0 0 0 1000px white inset !important;
  -webkit-text-fill-color: #111827 !important;
  caret-color: #111827;
}
```

CSS-токены (`globals.css`) используют нотацию Tailwind v4 (`--radius: 0.375rem` = `rounded`),
но auth-страницы используют **hardcoded Tailwind-классы** (`rounded-xl`, `border-gray-200` и т.д.),
а не семантические токены (`border-input`, `ring`). Это намеренно — auth-экраны изолированы от
темы дашборда.

---

## 17. Расхождения / долг

| Проблема | Где | Статус | Рекомендация |
|----------|-----|--------|-------------|
| FloatingField дублируется в auth-файлах | login, register, forgot-password, reset-password, set-password | ⚠️ Открыт | Переключить импорт на `@/components/ui/floating-field.tsx` |
| FloatingField в шагах онбординга | step-profile, step-account, step-venue, step-staff, step-quickresto-credentials | ✅ Исправлено | Уже используют `@/components/ui/floating-field` |
| PromoPanel / ProductMockup дублируется | login, register, forgot-password | ⚠️ Открыт | Вынести в `@/components/auth/promo-panel.tsx` |
| `getPasswordStrength` дублируется | register, reset-password, set-password | ⚠️ Открыт | Вынести в `@/lib/password-strength.ts` |
| Strength bar: в register — inline `style`, в reset — Tailwind-класс | register vs reset/set-password | ⚠️ Открыт | Унифицировать |
