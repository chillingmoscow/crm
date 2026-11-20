import {
  Users,
  CalendarDays,
  CalendarClock,
  CircleUserRound,
  ChartNoAxesCombined,
  Wallet,
  Banknote,
  Building2,
  BookOpen,
  ClipboardList,
  ClipboardCheck,
  Boxes,
  Warehouse,
  Settings as SettingsIcon,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * Вкладка «Права доступа» в карточке должности.
 *
 * Права (`permissions.code`) сгруппированы в РАЗДЕЛЫ, а разделы — в ГРУППЫ
 * («Гости и продажи», «Склад и документы», …). Раздел собирает права одного
 * или нескольких модулей БД (`permissions.module`): «Акты инвентаризации»,
 * например, объединяют inventory_documents, inventory_integration и
 * inventory_scope.
 *
 * У каждого раздела — кумулятивные уровни: каждый следующий включает все
 * права предыдущего. Уровень — просто готовый набор кодов, сами коды не
 * меняются. Последний уровень всегда равен всем правам раздела. Если
 * выданный набор не совпадает ни с одним уровнем, раздел показывает
 * «Свой набор». Инварианты проверяет `permission-modules.test.mts`.
 *
 * Файл импортируется из node:test — без алиасов `@/…`.
 */

export type PermissionLevel = {
  id: string;
  label: string;
  /** Что даёт уровень, в словах пользователя. */
  description: string;
  /** ПОЛНЫЙ (кумулятивный) набор кодов уровня — выбор уровня выставляет ровно его. */
  codes: readonly string[];
};

export type PermissionSectionDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Модули БД, права которых входят в раздел. */
  modules: readonly string[];
  /** Уровни от меньшего к большему, без «Нет доступа». */
  levels: readonly PermissionLevel[];
};

export type PermissionGroupDef = {
  id: string;
  label: string;
  sections: readonly PermissionSectionDef[];
};

export const NO_ACCESS_LEVEL = {
  id: "none",
  label: "Нет доступа",
  description: "Раздел недоступен",
} as const;

export const CUSTOM_LEVEL = {
  id: "custom",
  label: "Свой набор",
  description: "Отдельные права выбраны вручную и не совпадают ни с одним уровнем",
} as const;

type LevelStep = { id: string; label: string; description: string; add: readonly string[] };

/**
 * Собирает кумулятивные уровни: каждый следующий = предыдущий + `add`.
 * Описание шага — что он добавляет; у старших уровней к нему дописывается
 * «Как «Предыдущий», плюс …», чтобы текст читался и в меню, и под шапкой.
 */
function cumulative(steps: readonly LevelStep[]): PermissionLevel[] {
  const acc: string[] = [];
  return steps.map(({ add, description, ...rest }, i) => {
    acc.push(...add);
    const text =
      i === 0
        ? description
        : `Как «${steps[i - 1].label}», плюс ${description.charAt(0).toLocaleLowerCase("ru")}${description.slice(1)}`;
    return { ...rest, description: text, codes: [...acc] };
  });
}

const VIEW = "Просмотр";
const WORK = "Работа";
const FULL = "Полный доступ";

// ── Гости и продажи ─────────────────────────────────────────────────────────

const CRM: PermissionSectionDef = {
  id: "crm",
  label: "Гости",
  icon: CircleUserRound,
  modules: ["crm"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит базу гостей, брони и программы лояльности",
      add: ["crm.view_guests", "crm.view_reservations", "crm.view_loyalty"],
    },
    {
      id: "work",
      label: WORK,
      description: "открывает карточку гостя, ведёт гостей и брони, отменяет брони",
      add: [
        "crm.view_guest_details",
        "crm.manage_guests",
        "crm.manage_reservations",
        "crm.cancel_reservation",
      ],
    },
    {
      id: "full",
      label: FULL,
      description: "настраивает программы лояльности и вручную правит баланс гостя",
      add: ["crm.manage_loyalty", "crm.adjust_loyalty_balance"],
    },
  ]),
};

const SALES: PermissionSectionDef = {
  id: "sales",
  label: "Продажи",
  icon: ChartNoAxesCombined,
  modules: ["sales"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит смены, статистику и допродажи",
      add: ["sales.view_shifts"],
    },
    {
      id: "work",
      label: WORK,
      description: "загружает смены из Quick Resto, исправляет показатели и выгружает смены",
      add: ["sales.sync_shifts", "sales.adjust_shifts", "sales.export_shifts"],
    },
    {
      id: "full",
      label: FULL,
      description: "настраивает расчёт смен и пересчитывает историю",
      add: ["sales.configure_shifts"],
    },
  ]),
};

// ── График работы и зарплата ────────────────────────────────────────────────

const SCHEDULE_SHIFTS: PermissionSectionDef = {
  id: "schedule_shifts",
  label: "Расписание",
  icon: CalendarDays,
  modules: ["schedule_shifts"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит черновики, стажировки кандидатов и историю смен (опубликованный график видят все)",
      add: ["schedule.view_all"],
    },
    {
      id: "work",
      label: WORK,
      description: "создаёт, меняет, копирует и удаляет смены, назначает на них сотрудников",
      add: [
        "schedule.shift_create",
        "schedule.shift_edit",
        "schedule.shift_copy",
        "schedule.shift_delete",
        "schedule.shift_assign",
      ],
    },
    {
      id: "full",
      label: FULL,
      description: "публикует смены и настраивает дополнительные позиции сотрудников",
      add: ["schedule.shift_publish", "schedule.qualifications"],
    },
  ]),
};

const SCHEDULE_TEMPLATES: PermissionSectionDef = {
  id: "schedule_templates",
  label: "Шаблоны смен",
  icon: CalendarClock,
  modules: ["schedule_templates"],
  levels: cumulative([
    {
      id: "work",
      label: WORK,
      description: "Создаёт, меняет и копирует шаблоны смен",
      add: ["schedule.template_create", "schedule.template_edit", "schedule.template_copy"],
    },
    {
      id: "full",
      label: FULL,
      description: "отправляет шаблоны в архив",
      add: ["schedule.template_archive"],
    },
  ]),
};

const SCHEDULE_CHECKLISTS: PermissionSectionDef = {
  id: "schedule_checklists",
  label: "Задачи и чек-листы",
  icon: ClipboardCheck,
  modules: ["schedule_checklists"],
  levels: cumulative([
    {
      id: "review",
      label: "Проверка",
      description: "Проверяет выполнение чек-листов",
      add: ["schedule.review"],
    },
    {
      id: "work",
      label: WORK,
      description: "создаёт и меняет чек-листы",
      add: ["schedule.checklist_create", "schedule.checklist_edit"],
    },
    {
      id: "full",
      label: FULL,
      description: "публикует чек-листы и отправляет их в архив",
      add: ["schedule.checklist_publish", "schedule.checklist_archive"],
    },
  ]),
};

const PAYROLL: PermissionSectionDef = {
  id: "payroll",
  label: "Зарплата",
  icon: Banknote,
  modules: ["payroll"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит зарплату команды",
      add: ["payroll.view"],
    },
    {
      id: "work",
      label: WORK,
      description: "загружает табель и инкассации, проверяет начисления, учитывает выплаты",
      add: ["payroll.sync", "payroll.review", "payroll.pay"],
    },
    {
      id: "full",
      label: FULL,
      description: "утверждает ведомости и настраивает оплату труда",
      add: ["payroll.approve", "payroll.configure"],
    },
  ]),
};

// ── Склад и документы ───────────────────────────────────────────────────────

/** Уровни актов инвентаризации — со своими названиями (исторически сложились). */
const INVENTORY_ACTS: PermissionSectionDef = {
  id: "inventory_acts",
  label: "Акты инвентаризации",
  icon: ClipboardList,
  modules: ["inventory_documents", "inventory_integration", "inventory_scope"],
  levels: cumulative([
    {
      id: "executor",
      label: "Исполнитель",
      description: "Видит итоги акта, заполняет назначенные ему акты, комментирует итоги",
      add: [
        "inventory.view_results",
        "inventory.fill_assigned_documents",
        "inventory.comment_results",
      ],
    },
    {
      id: "editor",
      label: "Редактор",
      description:
        "видит все акты, назначает исполнителя и проверяющего, делает пересорт и исключения, отправляет на пересчёт, разносит списания по плательщикам, синхронизирует Quick Resto, пользуется AI-подсказками",
      add: [
        "inventory.view_documents",
        "inventory.manage_documents",
        "inventory.adjust_results",
        "inventory.recount_documents",
        "inventory.assign_writeoff_pool",
        "inventory.sync_quickresto",
        "inventory.use_ai_suggestions",
      ],
    },
    {
      id: "full",
      label: FULL,
      description:
        "проводит и переоткрывает акты, ставит удержания по недостаче в зарплату, видит все заведения",
      add: [
        "inventory.finalize_results",
        "inventory.post_deductions",
        "inventory.view_all_venues",
      ],
    },
  ]),
};

const INVENTORY_PRODUCTS: PermissionSectionDef = {
  id: "inventory_products",
  label: "Ингредиенты",
  icon: Boxes,
  modules: ["inventory_products"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит складские позиции",
      add: ["inventory.view_products"],
    },
    {
      id: "full",
      label: FULL,
      description: "редактирует позиции и их фото",
      add: ["inventory.manage_products"],
    },
  ]),
};

const INVENTORY_STORES: PermissionSectionDef = {
  id: "inventory_stores",
  label: "Склады",
  icon: Warehouse,
  modules: ["inventory_stores"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит склады",
      add: ["inventory.view_stores"],
    },
    {
      id: "full",
      label: FULL,
      description: "связывает склады с заведениями",
      add: ["inventory.manage_stores"],
    },
  ]),
};

// ── Финансы ─────────────────────────────────────────────────────────────────

const FINANCE: PermissionSectionDef = {
  id: "finance",
  label: "Финансы",
  icon: Wallet,
  modules: ["finance"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит дашборд, транзакции, счета, статьи, контрагентов и файлы",
      add: [
        "finance.view_dashboard",
        "finance.view_transactions",
        "finance.view_bank_accounts",
        "finance.view_categories",
        "finance.view_counterparties",
        "finance.view_attachments",
      ],
    },
    {
      id: "work",
      label: WORK,
      description: "создаёт транзакции, правит свои, прикрепляет файлы, выгружает данные",
      add: [
        "finance.create_transaction",
        "finance.update_transaction",
        "finance.upload_attachments",
        "finance.export",
      ],
    },
    {
      id: "manage",
      label: "Управление",
      description:
        "правит и удаляет любые транзакции и файлы, ведёт счета, статьи и контрагентов",
      add: [
        "finance.update_any_transaction",
        "finance.delete_transaction",
        "finance.delete_attachments",
        "finance.manage_bank_accounts",
        "finance.manage_categories",
        "finance.manage_counterparties",
      ],
    },
    {
      id: "full",
      label: FULL,
      description:
        "видит финансы всех юрлиц и заведений сразу, удаляет счета, статьи и контрагентов навсегда",
      add: [
        "finance.view_all_legal_entities",
        "finance.view_all_venues",
        "finance.delete_bank_account",
        "finance.delete_category",
        "finance.delete_counterparty",
      ],
    },
  ]),
};

// ── База знаний ─────────────────────────────────────────────────────────────

const KB: PermissionSectionDef = {
  id: "kb",
  label: "База знаний",
  icon: BookOpen,
  modules: ["kb"],
  levels: cumulative([
    {
      id: "read",
      label: "Чтение",
      description: "Читает страницы, оставляет комментарии, задаёт вопросы AI",
      add: ["kb.view_pages", "kb.comment_pages", "kb.ask_ai"],
    },
    {
      id: "author",
      label: "Автор",
      description:
        "создаёт и правит свои страницы, прикрепляет файлы, пользуется AI в редакторе, смотрит историю версий, скачивает страницы",
      add: [
        "kb.create_pages",
        "kb.edit_own_pages",
        "kb.manage_attachments",
        "kb.use_ai",
        "kb.view_version_history",
        "kb.export_pages",
      ],
    },
    {
      id: "editor",
      label: "Редактор",
      description:
        "правит, удаляет и блокирует любые страницы, загружает страницы из файлов, ведёт шаблоны",
      add: [
        "kb.edit_any_page",
        "kb.delete_pages",
        "kb.lock_pages",
        "kb.import_pages",
        "kb.manage_templates",
      ],
    },
    {
      id: "full",
      label: FULL,
      description: "назначает обязательное чтение и смотрит аналитику базы",
      add: ["kb.manage_required_reading", "kb.view_analytics"],
    },
  ]),
};

// ── Команда и организация ───────────────────────────────────────────────────

const PEOPLE: PermissionSectionDef = {
  id: "people",
  label: "Сотрудники и должности",
  icon: Users,
  modules: ["people"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит список сотрудников и должностей",
      add: ["people.view_staff", "people.view_roles"],
    },
    {
      id: "work",
      label: WORK,
      description:
        "открывает карточку сотрудника с документами, правит данные, приглашает и увольняет, ведёт кандидатов",
      add: [
        "people.view_staff_details",
        "people.edit_staff",
        "people.invite_staff",
        "people.terminate_staff",
        "people.manage_candidates",
      ],
    },
    {
      id: "full",
      label: FULL,
      description:
        "создаёт должности и меняет их права, удаляет должности, подразделения и сотрудников навсегда",
      add: [
        "people.manage_roles",
        "people.delete_role",
        "people.delete_department",
        "people.delete_staff",
      ],
    },
  ]),
};

const ORG: PermissionSectionDef = {
  id: "org",
  label: "Организация",
  icon: Building2,
  modules: ["org"],
  levels: cumulative([
    {
      id: "view",
      label: VIEW,
      description: "Видит аккаунт, юрлица и заведения",
      add: ["org.view_account", "org.view_legal_entities", "org.view_venues"],
    },
    {
      id: "work",
      label: WORK,
      description: "ведёт юрлица и заведения, видит журнал событий",
      add: ["org.manage_legal_entities", "org.manage_venues", "org.view_audit"],
    },
    {
      id: "full",
      label: FULL,
      description: "редактирует аккаунт, удаляет заведения и юрлица",
      add: ["org.manage_account", "org.delete_venue", "org.delete_legal_entity"],
    },
  ]),
};

const SETTINGS: PermissionSectionDef = {
  id: "settings",
  label: "Настройки",
  icon: SettingsIcon,
  modules: ["settings"],
  levels: cumulative([
    {
      id: "work",
      label: WORK,
      description: "Ищет реквизиты по ИНН и управляет рассылками",
      add: ["settings.use_dadata", "settings.manage_notifications"],
    },
    {
      id: "full",
      label: FULL,
      description: "подключает интеграции и управляет подпиской",
      add: ["settings.manage_integrations", "settings.manage_billing"],
    },
  ]),
};

/** Порядок на странице — сверху вниз. */
export const PERMISSION_GROUPS: readonly PermissionGroupDef[] = [
  { id: "guests_sales", label: "Гости и продажи", sections: [CRM, SALES] },
  {
    id: "schedule_payroll",
    label: "График работы и зарплата",
    sections: [SCHEDULE_SHIFTS, SCHEDULE_TEMPLATES, SCHEDULE_CHECKLISTS, PAYROLL],
  },
  {
    id: "inventory",
    label: "Склад и документы",
    sections: [INVENTORY_ACTS, INVENTORY_PRODUCTS, INVENTORY_STORES],
  },
  { id: "finance", label: "Финансы", sections: [FINANCE] },
  { id: "kb", label: "База знаний", sections: [KB] },
  { id: "team_org", label: "Команда и организация", sections: [PEOPLE, ORG, SETTINGS] },
];

export const PERMISSION_SECTIONS: readonly PermissionSectionDef[] =
  PERMISSION_GROUPS.flatMap((g) => g.sections);

/** Группа для модулей БД, которых ещё нет в раскладке (новая миграция). */
export const OTHER_GROUP_LABEL = "Другое";

/**
 * Раздел для модуля без раскладки: один уровень «Полный доступ» из всех его
 * прав. Право не теряется со страницы, пока его не разложили по уровням.
 */
export function fallbackSection(module: string, codes: readonly string[]): PermissionSectionDef {
  return {
    id: `module:${module}`,
    label: module,
    icon: Shield,
    modules: [module],
    levels: [{ id: "full", label: FULL, description: "Все права раздела", codes: [...codes] }],
  };
}

export type DetectedLevel = string; // id уровня | "none" | "custom"

/**
 * Определить уровень раздела по выданным правам.
 *
 * `available` — коды раздела, которые реально есть в БД. Уровень
 * сравнивается только по ним: если миграция с новым правом ещё не
 * применена, «Полный доступ» всё равно узнаётся.
 */
export function detectLevel(
  levels: readonly PermissionLevel[],
  granted: ReadonlySet<string>,
  available?: ReadonlySet<string>,
): DetectedLevel {
  if (granted.size === 0) return NO_ACCESS_LEVEL.id;
  for (const level of levels) {
    const codes = available ? level.codes.filter((c) => available.has(c)) : level.codes;
    if (codes.length === granted.size && codes.every((c) => granted.has(c))) {
      return level.id;
    }
  }
  return CUSTOM_LEVEL.id;
}

/** Порядок прав в «Отдельных правах»: как в уровнях, неизвестные — в конце. */
export function codeOrder(section: PermissionSectionDef): Map<string, number> {
  const order = new Map<string, number>();
  for (const level of section.levels) {
    for (const code of level.codes) if (!order.has(code)) order.set(code, order.size);
  }
  return order;
}
