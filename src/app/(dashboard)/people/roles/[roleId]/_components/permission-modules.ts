import {
  Users,
  CircleUserRound,
  Wallet,
  Building2,
  ClipboardList,
  Settings as SettingsIcon,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * Метаданные модулей прав. Ключ — `permissions.module` из БД (см.
 * supabase/migrations/034_new_permissions_and_accountant_role.sql:
 * 'people' | 'org' | 'finance' | 'inventory' | 'crm' | 'settings').
 *
 * Используется в детальной странице должности, чтобы каждой группе прав
 * показать иконку и понятный label по канону Sheerly DS.
 */

export type ModuleKey = "people" | "org" | "finance" | "inventory" | "crm" | "settings";

export interface ModuleMeta {
  label: string;
  icon: LucideIcon;
}

export const MODULE_META: Record<string, ModuleMeta> = {
  people:   { label: "Люди",         icon: Users },
  crm:      { label: "CRM",          icon: CircleUserRound },
  finance:  { label: "Финансы",      icon: Wallet },
  inventory:{ label: "Инвентаризация", icon: ClipboardList },
  org:      { label: "Организация",  icon: Building2 },
  settings: { label: "Настройки",    icon: SettingsIcon },
};

export function metaForModule(key: string): ModuleMeta {
  return MODULE_META[key] ?? { label: key, icon: Shield };
}

/** Стабильный порядок отображения групп на странице. */
export const MODULE_ORDER: string[] = ["crm", "finance", "inventory", "people", "org", "settings"];

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
