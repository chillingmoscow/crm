# Notifications: emitter guide

Короткий howto для добавления notification-emit'еров в новых
модулях (finance / schedule / staff и далее).

Notification-инфра общая на весь app. Bell в topbar читает все типы
по схеме `category` + `type` и рендерит через notification-row
(`src/components/shared/notification-row.tsx`). Всё что нужно —
правильно вставить row в `public.notifications` и зарегистрировать
тип в client-side registry.

---

## 1. Schema (где хранить)

`public.notifications` (миграция 013, расширенная в 098). Колонки,
важные для emit'а:

| Колонка | Что класть | Примечания |
|---|---|---|
| `user_id` | recipient | Для кого notif. RLS гейтит select/update по `user_id = auth.uid()`. |
| `type` | `kb.mention_in_page`, `finance.transaction_pending_approval`, … | `<category>.<event>` convention. |
| `category` | `'kb' / 'finance' / 'schedule' / 'staff' / 'system'` | Module-prefix. Для filter-chips в bell'е. |
| `actor_user_id` | юзер-инициатор | NULL для system-emit'ов (cron, миграции). Bell рендерит `<actor> <verb> <entity>`. |
| `entity_type` | `'kb_page' / 'finance_transaction' / …` | Discriminator. |
| `entity_id` | UUID сущности | Для дедупа и группировки. |
| `title` | короткий заголовок | Bell показывает в title row если без actor'а; иначе извлекается entity-имя из «: ». |
| `body` | описание | Used as fallback если payload.preview отсутствует. |
| `link` | `/path/in/app` | Bell делает `router.push(link)` при click + дефолтная кнопка «Открыть». |
| `payload` | jsonb | См. ниже. |

### `payload` schema

```jsonc
{
  "preview": "Первые ~180 chars сниппета сущности",   // опц.
  "preview_kind": "page_excerpt | comment_text | transaction_amount | ...",
  "actions": [                                         // опц.
    { "label": "Подтвердить", "action_type": "finance.approve_transaction", "target_id": "uuid" }
  ],
  // free-form per-emitter fields ниже
  "page_title": "...",
  "transaction_amount": 12345
}
```

Action-buttons рендерятся inline в bell-row'е. `action_type` —
dispatch-key для будущего action-registry на client'е (пока не
реализован — кнопки рендерятся, но click открывает `link`).

---

## 2. Эмиттер (как писать)

### Idempotency

Большинство notification-paths должны быть idempotent. Без этого
debounced auto-save / повторный INSERT / RLS-retry'и спамят.

Pattern: tracking-таблица `<module>_<event>_emitted` с PK по
естественному ключу события. Пример для KB:
- `kb_page_user_mentions(page_id, user_id, version_id)` → одна
  notif на (страница, юзер, версия).
- `kb_comment_user_mentions(comment_id, user_id)` → comment
  immutable, поэтому per-(comment, user).
- `kb_thread_recipient_cooldown(thread_id, recipient_id)` —
  TTL-tracking (5 минут per (thread, recipient)) для rate-limit'а.

INSERT INTO `<tracking>` ... ON CONFLICT DO NOTHING RETURNING — итерация
только по реально новым rows для эмита `notifications`.

### Permission gate

RPC должна проверять permission caller'а ДО emit'а. Без этого
`grant execute … to authenticated` позволяет fabricate-notif'ы для
произвольных user/entity комбинаций. См. паттерн из
`kb_emit_page_mentions` (миграция 100):

```sql
v_can_edit_any boolean := public.has_permission('kb.edit_any_page');
v_can_edit_own boolean := public.has_permission('kb.edit_own_pages');
...
if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
  return 0;  -- silent no-op для не-edit'оров
end if;
```

### Active-membership filter

Recipient должен быть active member в active account caller'а.
Иначе уволенным юзерам капают notif'ы по их старым тредам/проектам.

```sql
where exists (
  select 1 from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  where uvr.user_id = recipient_user_id
    and v.account_id = caller_account_id
    and uvr.status = 'active'
)
```

### Self-exclusion

`recipient_user_id <> auth.uid()` — actor не получает notif о
своём же действии.

### Возвращаемое значение

RPC возвращает `int` count emit'нутых notif'ов (для диагностики
на клиенте — `console.info("[finance-mentions] emitted", { count })`).
Permission denied / no-eligible-recipients = 0.

---

## 3. Client registry

Добавить новый type в `src/lib/notifications/registry.ts`:

```ts
"finance.transaction_pending_approval": {
  category: "finance",
  icon: ReceiptText,         // lucide-react
  iconColor: "text-emerald-500",
  verb: "ожидает подтверждения",
},
```

Bell автоматически:
- Подберёт icon + color.
- Соберёт title как `<actor.full_name> <verb> «<entity_name>»` если
  `actor_user_id` есть.
- Применит filter-chips на category (если в active scope ≥2 categories).

---

## 4. Realtime (всё уже работает)

`notifications` table в `supabase_realtime` publication (миграция
089). Bell подписан на INSERT'ы с filter `user_id=eq.<my>`. Любой
INSERT прилетает мгновенно, bell prepend'ит в state.

Никаких дополнительных шагов на стороне эмиттера не требуется.

---

## 5. Auto-archive

Прочитанные notif'ы старше 30 дней автоматически уезжают в архив
(`archived_at IS NOT NULL`) через
`public.auto_archive_old_notifications()` (миграция 099). Cron
trigger'ится через `/api/cron/auto-archive-notifications` —
external scheduler (Coolify scheduled-task / системный crontab)
POST'ит ежедневно с `X-Cron-Secret` header'ом.

Никаких action'ов от emitter'а не требуется — read=true rows
автоматом уйдут в архив через 30 дней.

---

## 6. Чек-лист для нового emit'ера

1. Migration: NEW tracking table (если нужен dedup) + emit RPC /
   trigger.
2. RPC: permission gate + active-membership filter + self-exclusion +
   ON CONFLICT idempotency + INSERT INTO `notifications` со всеми
   обязательными полями (включая `category`, `actor_user_id`,
   `entity_*`, `payload.preview`).
3. Client registry: добавить тип в
   `src/lib/notifications/registry.ts`.
4. Smoke-test: создать событие → row в `notifications` имеет
   правильные fields → у recipient'а bell-counter +1 без F5 → click
   → переход на link.

Готовых reference-эмиттеров: см. KB-эмиттеры в миграции 100
(`kb_notify_required_reading`, `kb_notify_comment_added`,
`kb_emit_page_mentions`, `kb_emit_comment_mentions`).
