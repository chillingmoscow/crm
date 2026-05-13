#!/usr/bin/env bash
# Регенерирует src/types/database.ts из локальной Supabase + дописывает
# hand-added блок. `supabase gen types` пишет ТОЛЬКО автогенерируемую часть —
# наши hand-added enum-алиасы (WorkingHours, VenueType, …) теряются при каждом
# прогоне, если не подклеить их вручную. Этот скрипт делает оба шага.
#
# Use:
#   pnpm regen:types
# или напрямую:
#   bash scripts/regen-types.sh
#
# Перед запуском убедитесь, что локальная БД поднята и применены миграции:
#   pnpm db:start  # или pnpm db:reset

set -euo pipefail

TARGET="src/types/database.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI не установлен. brew install supabase/tap/supabase" >&2
  exit 1
fi

# 1) Автоген. CLI пишет "Connecting to db ..." в stdout первой строкой —
#    отсекаем по sed-диапазону: оставляем от `export type Json` до `} as const`.
echo "→ supabase gen types typescript --local"
supabase gen types typescript --local 2>/dev/null \
  | sed -n '/^export type Json/,/^} as const$/p' > "$TMP"

if [ ! -s "$TMP" ]; then
  echo "Пустой вывод supabase gen — проверьте, что локальная БД запущена (pnpm db:status)." >&2
  exit 1
fi

# 2) Hand-added блок — TS-уровневые алиасы поверх Database.Enums. Они нужны,
#    чтобы код мог импортировать `VenueType`, `WorkingHours` и т. п. напрямую.
#    При расширении модели — добавляйте сюда же.
cat >> "$TMP" <<'EOF'


export interface WorkingHoursDay {
  open?: string
  close?: string
  closed: boolean
}

export interface WorkingHours {
  mon?: WorkingHoursDay
  tue?: WorkingHoursDay
  wed?: WorkingHoursDay
  thu?: WorkingHoursDay
  fri?: WorkingHoursDay
  sat?: WorkingHoursDay
  sun?: WorkingHoursDay
}

// ─── Hand-added enum aliases ─────────────────────────────────────────────────
// Эти алиасы НЕ генерируются supabase gen — это TS-обёртки поверх
// Database["public"]["Enums"]. Список синхронизирован с миграциями
// в supabase/migrations/. При добавлении нового enum'а в БД допишите сюда
// одну строку (и при необходимости обновите потребителей).
export type VenueType        = Database["public"]["Enums"]["venue_type"]
export type InvitationStatus = Database["public"]["Enums"]["invitation_status"]
export type LegalForm        = Database["public"]["Enums"]["legal_form_enum"]
export type TaxSystem        = Database["public"]["Enums"]["tax_system_enum"]
export type BankAccountType  = Database["public"]["Enums"]["bank_account_type_enum"]
export type FinanceCategoryType = Database["public"]["Enums"]["finance_category_type_enum"]
export type TransactionType  = Database["public"]["Enums"]["transaction_type_enum"]
export type TransactionSource = Database["public"]["Enums"]["transaction_source_enum"]
export type AttachmentDocumentType = Database["public"]["Enums"]["attachment_document_type_enum"]
EOF

mv "$TMP" "$TARGET"
echo "✓ $TARGET обновлён ($(wc -l <"$TARGET") строк)"
