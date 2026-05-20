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
