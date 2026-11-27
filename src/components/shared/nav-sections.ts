import {
  ArrowLeftRight,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  FileBadge2,
  FlaskConical,
  HandCoins,
  Inbox,
  LayoutDashboard,
  PackageSearch,
  Repeat,
  ScrollText,
  Settings,
  Shield,
  SlidersHorizontal,
  Tags,
  User,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
  Wand2,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * Разделы бокового меню — один источник для меню (`sidebar.tsx`) и палитры
 * ⌘K (`command-palette.tsx`): что видно в меню, то и находится переходом.
 */

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Permission code, который нужен для видимости пункта (например
   *  "kb.view_pages"). Если задан — фильтрация идёт по нему вместо
   *  `roles`. Чёткое предпочтение: задавать permission, не roles. */
  permission?: string;
  /** Any-of permission gate for pages that have several valid access
   *  paths, for example owner view + assigned employee fill access. */
  permissions?: string[];
  /** All-of gate: пункт виден, только если есть ВСЕ права (roles не смягчают). Для страниц,
   *  показывающих данные двух разных доменов, например итоги склада и зарплатные суммы. */
  allPermissions?: string[];
  /** Any-of добавка к `allPermissions`: к обязательным правам нужно ещё хотя бы одно из этих.
   *  Для отчёта об удержаниях: итоги склада обязательны, а поимённые суммы открывает либо
   *  payroll.view, либо право ставить удержания — кто ставит, тот видит результат. */
  anyPermissions?: string[];
  /** Legacy: список role-кодов. Используется только если permission
   *  не задан. Постепенно мигрируем все пункты на permission и потом
   *  это поле уберём. */
  roles?: string[];
  /** Optional count badge (e.g. unread, pending invitations). */
  badge?: number | string;
};

export type NavSection = {
  label: string;
  icon: LucideIcon;
  /** Section-level permission. Если не задано — секция видна, когда
   *  виден ХОТЯ БЫ ОДИН item (вычисляется автоматически). */
  permission?: string;
  /** Legacy fallback. Не задавать в новых секциях. */
  roles?: string[];
  items: NavItem[];
  /** When set, section renders as a direct top-level link (no toggle,
   *  no nested items). Use for "leaf" sections with no logical
   *  children — e.g. /knowledge, where the section IS the destination. */
  href?: string;
  /** Match the active state strictly (only exact pathname). Same
   *  semantic as NavItem.exact. Used together with href. */
  exact?: boolean;
};

// Permission-mapping для каждого пункта. См. supabase/migrations/*
// для исходного определения кодов; коды должны совпадать 1-в-1.
// Section-level permission НЕ задаём — section видна когда виден
// хотя бы один item (вычисляется в isSectionVisible ниже).
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Люди",
    icon: Users,
    items: [
      {
        title: "Сотрудники",
        href: "/people/staff",
        icon: User,
        permission: "people.view_staff",
      },
      { title: "Кандидаты", href: "/people/candidates", icon: User, permission: "people.manage_candidates" },
      { title: "Зарплата", href: "/people/payroll", icon: Wallet },
      {
        title: "Должности",
        href: "/people/roles",
        icon: Shield,
        permission: "people.view_roles",
      },
      {
        title: "Подразделения",
        href: "/people/departments",
        icon: Boxes,
        permission: "people.view_roles",
      },
    ],
  },
  {
    label: "График работы",
    icon: CalendarDays,
    items: [
      {
        title: "Расписание",
        href: "/schedule",
        icon: CalendarDays,
        exact: true,
      },
      {
        title: "Задачи",
        href: "/schedule/tasks",
        icon: ClipboardList,
        permissions: ["schedule.view_all", "schedule.checklist_create", "schedule.checklist_edit"],
      },
      {
        title: "Шаблоны смен",
        href: "/schedule/templates",
        icon: CalendarClock,
        permissions: ["schedule.template_create", "schedule.template_edit", "schedule.template_copy", "schedule.template_archive", "schedule.shift_create"],
      },
    ],
  },
  {
    label: "Продажи",
    icon: ChartNoAxesCombined,
    items: [
      // «Смены» — ежедневный экран, поэтому первыми; «Статистика» нужна реже.
      {
        title: "Смены",
        href: "/sales/shifts",
        icon: CalendarDays,
        permission: "sales.view_shifts",
      },
      {
        title: "Статистика",
        href: "/sales/statistics",
        icon: ChartNoAxesCombined,
        permission: "sales.view_shifts",
      },
      { title: "Допродажи", href: "/sales/additional", icon: HandCoins, permission: "sales.view_shifts" },
    ],
  },
  {
    label: "Организация",
    icon: Building2,
    items: [
      {
        title: "Аккаунт",
        href: "/org/account",
        icon: Settings,
        permission: "org.view_account",
      },
      {
        title: "Юридические лица",
        href: "/org/legal-entities",
        icon: FileBadge2,
        permission: "org.view_legal_entities",
      },
      {
        title: "Заведения",
        href: "/org/venues",
        icon: Building2,
        permission: "org.view_venues",
      },
      {
        title: "Склады",
        href: "/org/stores",
        icon: Warehouse,
        permission: "inventory.view_stores",
      },
      {
        title: "Журнал событий",
        href: "/org/audit",
        icon: ScrollText,
        permission: "org.view_audit",
      },
    ],
  },
  {
    // Финансы (стадии 4.x). Подпункты гейтятся каждый своим
    // finance.view_*; manage-уровень — на самих страницах.
    label: "Финансы",
    icon: Wallet,
    items: [
      // Очередь ожидаемых платежей; бейдж — сколько ждут разбора.
      {
        title: "На разбор",
        href: "/finance/inbox",
        icon: Inbox,
        permission: "finance.view_transactions",
      },
      // exact: чтобы Дашборд не выделялся, когда мы на /finance/categories
      // или другой дочерней странице.
      {
        title: "Дашборд",
        href: "/finance",
        icon: LayoutDashboard,
        exact: true,
        permission: "finance.view_dashboard",
      },

      {
        title: "Транзакции",
        href: "/finance/transactions",
        icon: ArrowLeftRight,
        permission: "finance.view_transactions",
      },
      {
        title: "Счета и кассы",
        href: "/finance/accounts",
        icon: Wallet,
        permission: "finance.view_bank_accounts",
      },
      {
        title: "Статьи",
        href: "/finance/categories",
        icon: Tags,
        permission: "finance.view_categories",
      },
      {
        title: "Контрагенты",
        href: "/finance/counterparties",
        icon: Users,
        permission: "finance.view_counterparties",
      },
      {
        title: "Повторяющиеся",
        href: "/finance/recurring",
        icon: Repeat,
        permission: "finance.view_transactions",
      },
      {
        title: "Правила",
        href: "/finance/rules",
        icon: Wand2,
        // Видит тот, кто видит операции, или тот, кто правила настраивает.
        permissions: ["finance.view_transactions", "finance.manage_posting_rules"],
      },
    ],
  },
  {
    // Номенклатура — справочник сущностей. Три раздела соответствуют видам
    // номенклатуры Quick Resto; товары появятся позже.
    label: "Номенклатура",
    icon: PackageSearch,
    items: [
      {
        title: "Ингредиенты",
        href: "/catalog/ingredients",
        icon: PackageSearch,
        permission: "inventory.view_products",
        roles: ["owner", "admin", "manager"],
      },
      {
        title: "Блюда",
        href: "/catalog/dishes",
        icon: UtensilsCrossed,
        permission: "inventory.view_products",
        roles: ["owner", "admin", "manager"],
      },
      {
        title: "Полуфабрикаты",
        href: "/catalog/semi-products",
        icon: FlaskConical,
        permission: "inventory.view_products",
        roles: ["owner", "admin", "manager"],
      },
    ],
  },
  {
    // Учётные документы: акты инвентаризации, приходные накладные, списания.
    label: "Документы",
    icon: ClipboardList,
    items: [
      {
        title: "Акты инвентаризации",
        href: "/documents/inventory",
        icon: ClipboardList,
        permissions: [
          "inventory.view_documents",
          "inventory.manage_documents",
          "inventory.fill_assigned_documents",
        ],
        roles: ["owner", "admin", "manager", "hostess", "waiter"],
      },
      {
        // Приходные накладные Quick Resto и их оплата. Жили в «Финансах» как
        // «Поставки»; это учётный документ, как акты и списания.
        title: "Приходные накладные",
        href: "/documents/supplies",
        icon: PackageSearch,
        permission: "finance.view_transactions",
      },
      {
        title: "Списания",
        href: "/documents/writeoffs",
        icon: ClipboardList,
        permission: "inventory.view_results",
        roles: ["owner", "admin", "manager"],
      },
    ],
  },
  {label: "Гости",icon: UserRound,href:"/crm/guests",permission:"crm.view_guests",items:[]},
  {
    // База знаний (стадия 8). Flat-section — клик по самому пункту
    // ведёт на /knowledge, без вложенных подпунктов и chevron'а.
    // permission — на section-уровне, потому что items пустой.
    label: "База знаний",
    icon: BookOpen,
    href: "/knowledge",
    permission: "kb.view_pages",
    items: [],
  },
  {
    label: "Настройки",
    icon: Settings,
    items: [
      {
        title: "Общие настройки",
        href: "/settings/general",
        icon: SlidersHorizontal,
        permission: "settings.manage_integrations",
      },
      {
        title: "Интеграции",
        href: "/settings/integrations",
        icon: Settings,
        permission: "settings.manage_integrations",
      },
    ],
  },
];

/** Пункт виден, если:
 *  - задан permission / permissions и хотя бы одно право есть, ИЛИ
 *  - задан legacy roles и активная роль в нём, ИЛИ
 *  - ни прав, ни ролей не задано (видят все). */
export function navItemVisible(
  item: NavItem,
  perms: ReadonlySet<string>,
  activeRoleCode: string | null,
): boolean {
  if (item.allPermissions || item.anyPermissions)
    return (
      (item.allPermissions ?? []).every((code) => perms.has(code)) &&
      (!item.anyPermissions || item.anyPermissions.some((code) => perms.has(code)))
    );
  const permissionCodes =
    item.permissions ?? (item.permission ? [item.permission] : []);
  if (permissionCodes.length > 0 && permissionCodes.some((code) => perms.has(code)))
    return true;
  if (item.roles) return !activeRoleCode || item.roles.includes(activeRoleCode);
  if (permissionCodes.length > 0) return false;
  return true;
}

/** Раздел виден, если есть его право, хотя бы один видимый пункт или это
 *  раздел-ссылка без прав (с legacy-ролями). */
export function navSectionVisible(
  section: NavSection,
  perms: ReadonlySet<string>,
  activeRoleCode: string | null,
): boolean {
  if (section.permission) return perms.has(section.permission);
  if (section.items.some((i) => navItemVisible(i, perms, activeRoleCode))) return true;
  if (section.href) {
    if (section.roles) return !activeRoleCode || section.roles.includes(activeRoleCode);
    return true;
  }
  return false;
}
