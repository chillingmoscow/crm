import {
  Users,
  CircleUserRound,
  Wallet,
  Building2,
  BookOpen,
  ClipboardList,
  Boxes,
  Warehouse,
  RefreshCw,
  Eye,
  Settings as SettingsIcon,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * Метаданные модулей прав. Ключ — `permissions.module` из БД.
 * Группа 'inventory' разделена на 5 подгрупп миграцией 206
 * (inventory_products / inventory_stores / inventory_documents /
 * inventory_integration / inventory_scope), исходный 'inventory'
 * больше не используется ни одним permission и оставлен только
 * как мягкий fallback на случай неприменённой миграции.
 */

export type ModuleKey =
  | "people"
  | "org"
  | "finance"
  | "inventory_products"
  | "inventory_stores"
  | "inventory_documents"
  | "inventory_integration"
  | "inventory_scope"
  | "crm"
  | "kb"
  | "settings";

export interface ModuleMeta {
  label: string;
  icon: LucideIcon;
}

export const MODULE_META: Record<string, ModuleMeta> = {
  people:                { label: "Люди",                          icon: Users },
  crm:                   { label: "CRM",                           icon: CircleUserRound },
  finance:               { label: "Финансы",                       icon: Wallet },
  inventory_products:    { label: "Ингредиенты",                   icon: Boxes },
  inventory_stores:      { label: "Склады",                        icon: Warehouse },
  inventory_documents:   { label: "Акты инвентаризации",           icon: ClipboardList },
  inventory_integration: { label: "Интеграция Quick Resto",        icon: RefreshCw },
  inventory_scope:       { label: "Расширенный доступ к инвентарю", icon: Eye },
  kb:                    { label: "База знаний",                   icon: BookOpen },
  org:                   { label: "Организация",                   icon: Building2 },
  settings:              { label: "Настройки",                     icon: SettingsIcon },
};

export function metaForModule(key: string): ModuleMeta {
  return MODULE_META[key] ?? { label: key, icon: Shield };
}

/** Стабильный порядок отображения групп на странице. */
export const MODULE_ORDER: string[] = [
  "crm",
  "finance",
  "inventory_documents",
  "inventory_products",
  "inventory_stores",
  "inventory_integration",
  "inventory_scope",
  "kb",
  "people",
  "org",
  "settings",
];

export function sortModuleKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = MODULE_ORDER.indexOf(a);
    const bi = MODULE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ── Уровни доступа к актам инвентаризации ──────────────────────────────────
//
// Три модуля прав (документы / интеграция QR / расширенный доступ) в
// редакторе роли показываются как ОДНА секция «Акты инвентаризации» с
// выбором уровня — вместо простыни из ~11 галок. Сами коды не меняются:
// уровень просто проставляет нужный набор. Тонкая настройка — в «Расширенно».
export const INVENTORY_ACTS_MODULES: string[] = [
  "inventory_documents",
  "inventory_integration",
  "inventory_scope",
];

/** Модуль-«якорь», в позиции которого рендерится объединённая секция. */
export const INVENTORY_ACTS_ANCHOR_MODULE = "inventory_documents";

export type InventoryActsTier = {
  id: "executor" | "editor" | "full";
  label: string;
  description: string;
  /** ПОЛНЫЙ (кумулятивный) набор кодов уровня — applyTier выставляет ровно его. */
  codes: string[];
};

const TIER_EXECUTOR = [
  "inventory.view_results",
  "inventory.fill_assigned_documents",
  "inventory.comment_results",
];
const TIER_EDITOR = [
  ...TIER_EXECUTOR,
  "inventory.view_documents",
  "inventory.manage_documents",
  "inventory.adjust_results",
  "inventory.recount_documents",
  "inventory.sync_quickresto",
  "inventory.use_ai_suggestions",
];
const TIER_FULL = [
  ...TIER_EDITOR,
  "inventory.finalize_results",
  "inventory.view_all_venues",
];

export const INVENTORY_ACTS_TIERS: InventoryActsTier[] = [
  {
    id: "executor",
    label: "Исполнитель",
    description:
      "Видит итоги акта, заполняет назначенные ему акты, комментирует итоги.",
    codes: TIER_EXECUTOR,
  },
  {
    id: "editor",
    label: "Редактор",
    description:
      "Всё, что у исполнителя, плюс: видит все акты, назначает исполнителя и проверяющего, делает пересорт и исключения, отправляет на пересчёт, синхронизирует Quick Resto, использует AI-подсказки.",
    codes: TIER_EDITOR,
  },
  {
    id: "full",
    label: "Полный доступ",
    description:
      "Всё, что у редактора, плюс: финализация и разблокировка проведённого акта, видимость всех заведений.",
    codes: TIER_FULL,
  },
];

/** Определить текущий уровень по набору выданных кодов кластера. */
export function detectInventoryActsTier(
  grantedCodes: Set<string>,
): "none" | "executor" | "editor" | "full" | "custom" {
  if (grantedCodes.size === 0) return "none";
  for (const tier of INVENTORY_ACTS_TIERS) {
    if (
      tier.codes.length === grantedCodes.size &&
      tier.codes.every((code) => grantedCodes.has(code))
    ) {
      return tier.id;
    }
  }
  return "custom";
}
